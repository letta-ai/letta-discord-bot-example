import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { Events } from "discord.js";
import { loadConfig } from "../src/config.ts";
import { startDiscord } from "../src/discord/gateway.ts";
import { RouteStore } from "../src/letta/store.ts";
import type { AgentBridge } from "../src/types.ts";

const BOT = "999";
const base = { DISCORD_BOT_TOKEN: "x", LETTA_API_KEY: "y", LETTA_AGENT_ID: "agent-1", REGISTER_SLASH_COMMANDS: "false" };
const cfg = (extra: Record<string, string> = {}) => loadConfig({ ...base, ...extra });

function fakeClient() {
  const client = new EventEmitter() as EventEmitter & Record<string, unknown>;
  client.user = { id: BOT, username: "bot" };
  client.login = async () => "ok";
  client.destroy = async () => {};
  return client;
}

function message(id: string, authorId = "u1") {
  const channel = {
    id: "c1",
    isThread: () => false,
    isDMBased: () => false,
    send: async () => ({}),
    sendTyping: async () => {},
  };
  return {
    id,
    partial: false,
    system: false,
    content: `<@${BOT}> hi`,
    createdAt: new Date(0),
    guildId: "g1",
    author: { id: authorId, bot: false, username: "ann" },
    member: { displayName: "Ann", roles: { cache: { has: () => false } } },
    channel,
    mentions: { users: { has: (u: string) => u === BOT } },
    attachments: { values: () => [] },
    react: async () => {},
  };
}

function recordingBridge(submitted: string[][]): AgentBridge {
  return {
    async submit(batch, ctx) {
      submitted.push(batch.map((m) => m.messageId));
      ctx.onEvent({ kind: "done", success: true, durationMs: 0 });
    },
    async cancel() {
      return false;
    },
    async reset() {},
    async status() {
      return { busy: false, queued: 0, hasConversation: false };
    },
    async shutdown() {},
  };
}

describe("gateway dispatch", () => {
  test("DEBOUNCE_MS=0 dispatches the first message on a route", async () => {
    const submitted: string[][] = [];
    const client = fakeClient();
    const runtime = await startDiscord(
      cfg({ DEBOUNCE_MS: "0", AUTO_THREAD: "false" }),
      recordingBridge(submitted),
      new RouteStore(":memory:"),
      client as never,
    );
    client.emit(Events.MessageCreate, message("m1"));
    client.emit(Events.MessageCreate, message("m2"));
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toEqual([["m1"], ["m2"]]);
    await runtime.stop();
  });

  test("debounced bursts from one author merge into one dispatch", async () => {
    const submitted: string[][] = [];
    const client = fakeClient();
    const runtime = await startDiscord(
      cfg({ DEBOUNCE_MS: "20", AUTO_THREAD: "false" }),
      recordingBridge(submitted),
      new RouteStore(":memory:"),
      client as never,
    );
    client.emit(Events.MessageCreate, message("m1"));
    client.emit(Events.MessageCreate, message("m2"));
    await new Promise((r) => setTimeout(r, 60));
    expect(submitted).toEqual([["m1", "m2"]]);
    await runtime.stop();
  });
});
