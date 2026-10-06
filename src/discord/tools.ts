import type { AnyAgentTool } from "@letta-ai/letta-agent-sdk";
import { posix as path } from "node:path";
import { replyModeFor, type Config } from "../config.ts";
import type { ToolFactory } from "../types.ts";
import { splitForDiscord } from "./split.ts";

interface DiscordAttachmentLike {
  name?: string | null;
}

interface DiscordMessageLike {
  id: string;
  content?: string | null;
  createdAt?: Date;
  createdTimestamp?: number;
  author?: { id?: string; username?: string; globalName?: string | null };
  member?: { displayName?: string } | null;
  attachments?: { values(): Iterable<DiscordAttachmentLike> };
  react(emoji: string): Promise<unknown>;
}

interface DiscordChannelLike {
  isTextBased(): boolean;
  send(options: Record<string, unknown>): Promise<unknown>;
  messages: {
    fetch(idOrOptions: string | { limit: number; before?: string }): Promise<DiscordMessageLike | { values(): Iterable<DiscordMessageLike> }>;
  };
}

/** Minimal Discord client surface needed by listener-owned tools. */
export interface DiscordClientLike {
  channels: { fetch(id: string): Promise<unknown> };
}

const NO_MENTIONS = { parse: [] as string[] };
const MAX_DISCORD_FILE_BYTES = 25 * 1024 * 1024;

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) };
}

function errorResult(message: string) {
  return textResult(message, true);
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tool arguments.");
  return value as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && value.length === 0)) throw new Error(`Invalid ${key}.`);
  return value;
}

function asChannel(value: unknown): DiscordChannelLike {
  const channel = value as Partial<DiscordChannelLike> | null;
  if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased() || typeof channel.send !== "function" || !channel.messages) {
    throw new Error("This Discord route is not available.");
  }
  return channel as DiscordChannelLike;
}

function collectionValues(value: DiscordMessageLike | { values(): Iterable<DiscordMessageLike> }): DiscordMessageLike[] {
  if (value && typeof (value as { values?: unknown }).values === "function") {
    return [...(value as { values(): Iterable<DiscordMessageLike> }).values()];
  }
  return [value as DiscordMessageLike];
}

function historyLine(message: DiscordMessageLike): string {
  const timestamp = message.createdAt?.toISOString() ?? new Date(message.createdTimestamp ?? 0).toISOString();
  const name = message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? "Unknown";
  const attachments = message.attachments ? [...message.attachments.values()].map((a) => a.name).filter(Boolean) : [];
  let body = message.content ?? "";
  if (attachments.length) body += `${body ? " " : ""}[attachments: ${attachments.join(", ")}]`;
  const prefix = `[${timestamp}] ${name} (${message.author?.id ?? "unknown"}): `;
  return (prefix + body).slice(0, 500);
}

export const SEND_MESSAGE_DESCRIPTION =
  "Post a message in this Discord channel. This is the only way to speak here: your plain text replies are not shown. " +
  "Most messages in this channel are not addressed to you. Call this only when you have something worth saying, " +
  "and otherwise end your turn without calling it.";

/**
 * Relay routes post assistant text automatically, so they never get
 * discord_send_message. Tool routes always get it, even with
 * ENABLE_DISCORD_TOOLS=false, because it is their only way to speak.
 */
export function createDiscordToolFactory(deps: { client: DiscordClientLike; config: Config }): ToolFactory {
  return (route, currentTurn, sandbox): AnyAgentTool[] => {
    // Routes pinned to one conversation share a session, so act on the route of
    // the turn being run, not the one that opened the session.
    const routeChannel = async () => {
      const r = currentTurn()?.route ?? route;
      return asChannel(await deps.client.channels.fetch(r.threadId ?? r.channelId));
    };

    const tools: AnyAgentTool[] = [
      {
        name: "discord_react",
        label: "React in Discord",
        description: "Add a reaction to a message in this Discord conversation.",
        parameters: {
          type: "object",
          properties: { emoji: { type: "string" }, message_id: { type: "string" } },
          required: ["emoji"],
          additionalProperties: false,
        },
        async execute(_toolCallId, rawArgs) {
          try {
            const args = objectArgs(rawArgs);
            const emoji = stringArg(args, "emoji", true)!;
            const messageId = stringArg(args, "message_id") ?? currentTurn()?.triggerMessageId;
            if (!messageId) throw new Error("No current Discord message is available.");
            const channel = await routeChannel();
            const message = await channel.messages.fetch(messageId);
            if (!message || typeof (message as DiscordMessageLike).react !== "function") throw new Error("Message not found in this Discord conversation.");
            await (message as DiscordMessageLike).react(emoji);
            return textResult("Reaction added.");
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : "Could not add the reaction.");
          }
        },
      },
      {
        name: "discord_read_history",
        label: "Read Discord history",
        description: "Read recent messages from this Discord conversation, oldest first.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            before_message_id: { type: "string" },
          },
          additionalProperties: false,
        },
        async execute(_toolCallId, rawArgs) {
          try {
            const args = objectArgs(rawArgs);
            const rawLimit = args.limit ?? 20;
            if (!Number.isInteger(rawLimit) || (rawLimit as number) < 1 || (rawLimit as number) > 50) throw new Error("Limit must be from 1 to 50.");
            const before = stringArg(args, "before_message_id");
            const channel = await routeChannel();
            const fetched = await channel.messages.fetch({ limit: rawLimit as number, ...(before ? { before } : {}) });
            const messages = collectionValues(fetched).sort((a, b) => (a.createdTimestamp ?? a.createdAt?.getTime() ?? 0) - (b.createdTimestamp ?? b.createdAt?.getTime() ?? 0));
            const text = messages.map(historyLine).join("\n").slice(0, 12_000);
            return textResult(text || "No messages found.");
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : "Could not read Discord history.");
          }
        },
      },
      {
        name: "discord_send_message",
        label: "Send Discord message",
        description: SEND_MESSAGE_DESCRIPTION,
        parameters: {
          type: "object",
          properties: { content: { type: "string" }, reply_to_message_id: { type: "string" } },
          required: ["content"],
          additionalProperties: false,
        },
        async execute(_toolCallId, rawArgs) {
          try {
            const args = objectArgs(rawArgs);
            const content = stringArg(args, "content", true)!;
            const replyTo = stringArg(args, "reply_to_message_id");
            const channel = await routeChannel();
            const chunks = splitForDiscord(content);
            if (!chunks.length) throw new Error("Message content cannot be empty.");
            for (let i = 0; i < chunks.length; i++) {
              await channel.send({
                content: chunks[i],
                allowedMentions: NO_MENTIONS,
                ...(replyTo && i === 0 ? { reply: { messageReference: replyTo, failIfNotExists: true } } : {}),
              });
            }
            return textResult(`Sent ${chunks.length} Discord message${chunks.length === 1 ? "" : "s"}.`);
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : "Could not send the Discord message.");
          }
        },
      },
    ];

    if (deps.config.ENABLE_DISCORD_TOOLS && sandbox) {
      tools.push({
        name: "discord_send_file",
        label: "Send file to Discord",
        description: "Upload a file to this Discord conversation. Save or copy the file into /root/downloads first, then provide its absolute path.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
        async execute(_toolCallId, rawArgs) {
          try {
            const args = objectArgs(rawArgs);
            const filePath = stringArg(args, "path", true)!;
            const content = stringArg(args, "content");
            const normalized = path.normalize(filePath);
            if (!path.isAbsolute(filePath) || normalized !== filePath || filePath.split("/").includes("..") || !filePath.startsWith("/root/downloads/") || path.basename(filePath) === "") {
              throw new Error("File path must be a normalized path under /root/downloads/.");
            }
            const data = await sandbox.downloadFile(filePath);
            const maxBytes = Math.min(deps.config.MAX_FILE_BYTES, MAX_DISCORD_FILE_BYTES);
            if (data.byteLength > maxBytes) throw new Error(`File is too large (maximum ${maxBytes} bytes).`);
            const channel = await routeChannel();
            await channel.send({
              ...(content ? { content } : {}),
              files: [{ attachment: Buffer.from(data), name: path.basename(filePath) }],
              allowedMentions: NO_MENTIONS,
            });
            return textResult("File sent.");
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : "Could not send the file.");
          }
        },
      });
    }

    const toolMode = replyModeFor(deps.config, route) === "tool";
    return tools.filter((t) =>
      t.name === "discord_send_message" ? toolMode : t.name === "discord_send_file" || deps.config.ENABLE_DISCORD_TOOLS,
    );
  };
}
