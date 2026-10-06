import { readFileSync } from "node:fs";
import { z } from "zod";
import type { RouteKey } from "./types.ts";

/**
 * Routing table: pins Discord surfaces to existing Letta conversations.
 *
 * Without a table every route (thread, open channel, DM) gets its own
 * conversation, created on first use. A table lets an operator send chosen
 * surfaces to a conversation that already exists, such as the agent's default
 * conversation. Several surfaces may share one conversation.
 */

const Target = z
  .string()
  .min(1)
  .refine((v) => v === "auto" || v === "default" || /^(local-)?conv-/.test(v), {
    message: 'must be a conversation id (conv-...), "default", or "auto"',
  });

const id = z.string().regex(/^\d+$/, "must be a Discord snowflake id");

const Entry = z.union([
  z.object({ thread: id, conversation: Target }).strict(),
  z.object({ channel: id, conversation: Target }).strict(),
  z.object({ dm: id, conversation: Target }).strict(),
  z.object({ guild: id, conversation: Target }).strict(),
]);

export const RoutingTableSchema = z
  .object({
    routes: z.array(Entry).default([]),
    /** Target for routes no entry matches. Omitted = "auto". */
    fallback: Target.optional(),
  })
  .strict()
  .superRefine((table, ctx) => {
    const seen = new Set<string>();
    table.routes.forEach((entry, i) => {
      const [kind, value] = selector(entry);
      const key = `${kind}:${value}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["routes", i], message: `duplicate ${kind} ${value}` });
      seen.add(key);
    });
  });

export type RoutingTable = z.infer<typeof RoutingTableSchema>;
type RouteEntry = RoutingTable["routes"][number];
type SelectorKind = "thread" | "channel" | "dm" | "guild";

function selector(entry: RouteEntry): [SelectorKind, string] {
  if ("thread" in entry) return ["thread", entry.thread];
  if ("channel" in entry) return ["channel", entry.channel];
  if ("dm" in entry) return ["dm", entry.dm];
  return ["guild", entry.guild];
}

export type RouteTarget =
  | { kind: "auto" }
  /** `conversationId` is a conv- id or "default" (the agent's default conversation). */
  | { kind: "pinned"; conversationId: string; rule: string };

/**
 * Most specific rule wins: thread, then channel (which also covers threads
 * under it), then DM user, then guild, then `fallback`.
 */
export function resolveRoute(table: RoutingTable | null | undefined, route: RouteKey): RouteTarget {
  if (!table) return { kind: "auto" };
  const find = (kind: SelectorKind, value: string | null | undefined) =>
    value ? table.routes.find((e) => selector(e)[0] === kind && selector(e)[1] === value) : undefined;
  const hit =
    find("thread", route.threadId) ??
    (route.guildId !== null ? find("channel", route.channelId) : undefined) ??
    (route.guildId === null ? find("dm", route.userId) : undefined) ??
    find("guild", route.guildId);
  const conversation = hit?.conversation ?? table.fallback ?? "auto";
  if (conversation === "auto") return { kind: "auto" };
  const rule = hit ? selector(hit).join(":") : "fallback";
  return { kind: "pinned", conversationId: conversation, rule };
}

/** Every pinned conversation id in the table (excluding "auto"). */
export function pinnedConversations(table: RoutingTable): string[] {
  const all = [...table.routes.map((e) => e.conversation), ...(table.fallback ? [table.fallback] : [])];
  return [...new Set(all.filter((c) => c !== "auto"))];
}

export function parseRoutingTable(text: string, source = "routing table"): RoutingTable {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  const parsed = RoutingTableSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${source}:\n${issues}`);
  }
  return parsed.data;
}

export function loadRoutingTable(path: string | undefined): RoutingTable | null {
  if (!path) return null;
  return parseRoutingTable(readFileSync(path, "utf8"), path);
}
