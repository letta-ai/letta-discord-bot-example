import { describe, expect, test } from "bun:test";
import { replyModeFor, type Config } from "../src/config.ts";
import { createDiscordToolFactory } from "../src/discord/tools.ts";
import type { RouteKey, SandboxFiles, TurnContext } from "../src/types.ts";

// The route below is a thread under an open channel in tool mode, so every tool is offered.
const config = {
  MAX_FILE_BYTES: 1024,
  ENABLE_DISCORD_TOOLS: true,
  DISCORD_OPEN_CHANNEL_IDS: ["parent"],
  OPEN_CHANNEL_REPLY_MODE: "tool",
} as Config;
const route: RouteKey = { guildId: "g", channelId: "parent", threadId: "thread" };

function harness() {
  const sent: Record<string, unknown>[] = [];
  const reacted: string[] = [];
  const fetches: unknown[] = [];
  const messages = [
    {
      id: "new",
      content: "new text",
      createdTimestamp: 200,
      author: { id: "u2", username: "New" },
      attachments: new Map(),
      react: async (emoji: string) => reacted.push(emoji),
    },
    {
      id: "old",
      content: "old text",
      createdTimestamp: 100,
      author: { id: "u1", username: "Old" },
      attachments: new Map([["a", { name: "note.txt" }]]),
      react: async (emoji: string) => reacted.push(emoji),
    },
  ];
  const channel = {
    isTextBased: () => true,
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return {};
    },
    messages: {
      fetch: async (arg: unknown) => {
        fetches.push(arg);
        if (typeof arg === "string") return messages.find((message) => message.id === arg);
        return new Map(messages.map((message) => [message.id, message]));
      },
    },
  };
  const channelIds: string[] = [];
  const client = {
    channels: {
      fetch: async (id: string) => {
        channelIds.push(id);
        return channel;
      },
    },
  };
  return { client, sent, reacted, fetches, channelIds };
}

function turn(): TurnContext {
  return {
    route,
    triggerMessageId: "old",
    requesterId: "u1",
    onEvent() {},
    async requestApproval() {
      return { allow: true };
    },
  };
}

describe("Discord tools", () => {
  test("reacts to the current trigger in the route channel", async () => {
    const h = harness();
    const tools = createDiscordToolFactory({ client: h.client, config })(route, turn, null);
    const result = await tools.find((tool) => tool.name === "discord_react")!.execute("call", { emoji: "✅" });
    expect(result.isError).toBeUndefined();
    expect(h.channelIds).toEqual(["thread"]);
    expect(h.fetches).toEqual(["old"]);
    expect(h.reacted).toEqual(["✅"]);
  });

  test("reads bounded history oldest first with attachment names", async () => {
    const h = harness();
    const tools = createDiscordToolFactory({ client: h.client, config })(route, turn, null);
    const result = await tools.find((tool) => tool.name === "discord_read_history")!.execute("call", {
      limit: 2,
      before_message_id: "cursor",
    });
    const text = result.content[0]!.text!;
    expect(h.fetches).toEqual([{ limit: 2, before: "cursor" }]);
    expect(text.indexOf("Old")).toBeLessThan(text.indexOf("New"));
    expect(text).toContain("note.txt");
    expect(text.length).toBeLessThanOrEqual(12_000);
  });

  test("splits additional messages and disables mentions", async () => {
    const h = harness();
    const tools = createDiscordToolFactory({ client: h.client, config })(route, turn, null);
    const result = await tools.find((tool) => tool.name === "discord_send_message")!.execute("call", {
      content: "x".repeat(2500),
      reply_to_message_id: "old",
    });
    expect(result.isError).toBeUndefined();
    expect(h.sent.length).toBe(2);
    expect(h.sent[0]!.allowedMentions).toEqual({ parse: [] });
    expect(h.sent[0]!.reply).toEqual({ messageReference: "old", failIfNotExists: true });
    expect(h.sent[1]!.reply).toBeUndefined();
  });

  test("only offers send-file with a sandbox and validates its path", async () => {
    const h = harness();
    expect(createDiscordToolFactory({ client: h.client, config })(route, turn, null).map((tool) => tool.name)).not.toContain(
      "discord_send_file",
    );
    const downloaded: string[] = [];
    const sandbox = {
      async downloadFile(path: string) {
        downloaded.push(path);
        return new Uint8Array([1, 2, 3]);
      },
    } as SandboxFiles;
    const tool = createDiscordToolFactory({ client: h.client, config })(route, turn, sandbox).find(
      (candidate) => candidate.name === "discord_send_file",
    )!;
    const rejected = await tool.execute("call", { path: "/root/downloads/../secret" });
    expect(rejected.isError).toBe(true);
    expect(downloaded).toEqual([]);

    const result = await tool.execute("call", { path: "/root/downloads/report.txt", content: "Report" });
    expect(result.isError).toBeUndefined();
    expect(downloaded).toEqual(["/root/downloads/report.txt"]);
    expect((h.sent[0]!.files as { name: string }[])[0]!.name).toBe("report.txt");
  });

  test("returns model-visible errors instead of throwing", async () => {
    const client = { channels: { fetch: async () => null } };
    const tool = createDiscordToolFactory({ client, config })(route, turn, null).find(
      (candidate) => candidate.name === "discord_send_message",
    )!;
    const result = await tool.execute("call", { content: "hello" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.type).toBe("text");
  });
});

describe("reply modes", () => {
  const names = (c: Partial<Config>, r: RouteKey) =>
    createDiscordToolFactory({ client: harness().client, config: { ...config, ...c } as Config })(r, turn, null).map((t) => t.name);
  const dm: RouteKey = { guildId: null, channelId: "parent", threadId: null };
  const elsewhere: RouteKey = { guildId: "g", channelId: "other", threadId: null };

  test("relay routes never get discord_send_message", () => {
    expect(names({ OPEN_CHANNEL_REPLY_MODE: "relay" }, route)).not.toContain("discord_send_message");
    expect(names({}, elsewhere)).not.toContain("discord_send_message");
    expect(names({}, dm)).not.toContain("discord_send_message");
    expect(names({}, elsewhere)).toEqual(["discord_react", "discord_read_history"]);
  });

  test("tool routes keep discord_send_message even with Discord tools disabled", () => {
    expect(names({ ENABLE_DISCORD_TOOLS: false }, route)).toEqual(["discord_send_message"]);
    expect(names({ ENABLE_DISCORD_TOOLS: false }, elsewhere)).toEqual([]);
  });

  test("replyModeFor covers open channels and their threads only", () => {
    const tool = { DISCORD_OPEN_CHANNEL_IDS: ["parent", "openthread"], OPEN_CHANNEL_REPLY_MODE: "tool" as const };
    expect(replyModeFor(tool, { guildId: "g", channelId: "parent", threadId: null })).toBe("tool");
    expect(replyModeFor(tool, route)).toBe("tool");
    expect(replyModeFor(tool, { guildId: "g", channelId: "other", threadId: "openthread" })).toBe("tool");
    expect(replyModeFor(tool, elsewhere)).toBe("relay");
    expect(replyModeFor(tool, dm)).toBe("relay");
    expect(replyModeFor({ ...tool, OPEN_CHANNEL_REPLY_MODE: "relay" }, route)).toBe("relay");
  });
});
