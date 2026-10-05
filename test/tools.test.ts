import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.ts";
import { createDiscordToolFactory } from "../src/discord/tools.ts";
import type { RouteKey, SandboxFiles, TurnContext } from "../src/types.ts";

const config = { MAX_FILE_BYTES: 1024 } as Config;
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
