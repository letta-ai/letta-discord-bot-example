import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { Debouncer, Deduper, collectAttachments, gate, stripMention, threadName, type IngressMessage } from "../src/discord/ingress.ts";

const BOT = "999";
const base = { DISCORD_BOT_TOKEN: "x", LETTA_API_KEY: "y", LETTA_AGENT_ID: "agent-1" };
const cfg = (extra: Record<string, string> = {}) => loadConfig({ ...base, ...extra });

function msg(over: Partial<{
  authorId: string; bot: boolean; content: string; guildId: string | null; dm: boolean; thread: boolean;
  channelId: string; parentId: string; mentioned: boolean; roles: string[];
}> = {}): IngressMessage {
  const o = { authorId: "u1", bot: false, content: `<@${BOT}> hi`, guildId: "g1", dm: false, thread: false, channelId: "c1", parentId: "c1", mentioned: true, roles: [], ...over };
  return {
    id: "m1",
    content: o.content,
    createdAt: new Date(0),
    guildId: o.dm ? null : o.guildId,
    author: { id: o.authorId, bot: o.bot, username: "ann" },
    member: { displayName: "Ann", roles: { cache: { has: (r: string) => o.roles.includes(r) } } },
    channel: { id: o.channelId, isThread: () => o.thread, isDMBased: () => o.dm, parentId: o.parentId },
    mentions: { users: { has: (id: string) => o.mentioned && id === BOT } },
    attachments: { values: () => [] },
  };
}

const deps = (known: string[] = []) => ({ botUserId: BOT, isBotThread: (id: string) => known.includes(id), hasRoute: () => false });

describe("gate", () => {
  test("ignores self and bots", () => {
    expect(gate(cfg(), msg({ authorId: BOT }), deps())).toMatchObject({ accept: false, reason: "self" });
    expect(gate(cfg(), msg({ bot: true }), deps())).toMatchObject({ accept: false, reason: "bot" });
    expect(gate(cfg({ RESPOND_TO_BOTS: "true" }), msg({ bot: true }), deps()).accept).toBe(true);
  });

  test("channel mention auto-threads; unmentioned is ignored", () => {
    expect(gate(cfg(), msg(), deps())).toMatchObject({ accept: true, needsThread: true });
    expect(gate(cfg({ AUTO_THREAD: "false" }), msg(), deps())).toMatchObject({ accept: true, needsThread: false });
    expect(gate(cfg(), msg({ mentioned: false }), deps())).toMatchObject({ accept: false, reason: "not-mentioned" });
  });

  test("open channels need no mention", () => {
    expect(gate(cfg({ DISCORD_OPEN_CHANNEL_IDS: "c1" }), msg({ mentioned: false }), deps()).accept).toBe(true);
  });

  test("threads: known bot threads need no mention, route uses parent + thread", () => {
    const m = msg({ thread: true, channelId: "t1", parentId: "c1", mentioned: false });
    expect(gate(cfg(), m, deps()).accept).toBe(false);
    const d = gate(cfg(), m, deps(["t1"]));
    expect(d).toMatchObject({ accept: true, route: { guildId: "g1", channelId: "c1", threadId: "t1" }, needsThread: false });
  });

  test("allowlists for guilds, channels and users; admins by role bypass user allowlist", () => {
    expect(gate(cfg({ DISCORD_GUILD_IDS: "g2" }), msg(), deps()).accept).toBe(false);
    expect(gate(cfg({ DISCORD_CHANNEL_IDS: "c2" }), msg(), deps()).accept).toBe(false);
    expect(gate(cfg({ DISCORD_ALLOWED_USER_IDS: "u2" }), msg(), deps()).accept).toBe(false);
    expect(gate(cfg({ DISCORD_ALLOWED_USER_IDS: "u2", DISCORD_ADMIN_ROLE_IDS: "r1" }), msg({ roles: ["r1"] }), deps()).accept).toBe(true);
    // Thread in an allowed parent channel
    expect(gate(cfg({ DISCORD_CHANNEL_IDS: "c1" }), msg({ thread: true, channelId: "t1", parentId: "c1" }), deps()).accept).toBe(true);
  });

  test("DM policy", () => {
    const dm = msg({ dm: true, channelId: "d1", mentioned: false });
    expect(gate(cfg({ DM_POLICY: "off" }), dm, deps()).accept).toBe(false);
    expect(gate(cfg({ DM_POLICY: "allowlist" }), dm, deps()).accept).toBe(false);
    expect(gate(cfg({ DM_POLICY: "allowlist", DISCORD_ALLOWED_USER_IDS: "u1" }), dm, deps())).toMatchObject({
      accept: true,
      route: { guildId: null, channelId: "d1", threadId: null },
    });
    expect(gate(cfg({ DM_POLICY: "open" }), dm, deps()).accept).toBe(true);
  });
});

describe("helpers", () => {
  test("stripMention and threadName", () => {
    expect(stripMention(`<@${BOT}> hello <@!${BOT}>`, BOT)).toBe("hello");
    expect(threadName("  \nfix the build please", "Chat")).toBe("fix the build please");
    expect(threadName("", "Chat")).toBe("Chat");
    expect(threadName("x".repeat(100), "Chat").length).toBe(60);
  });

  test("deduper", () => {
    const d = new Deduper(1000);
    expect(d.firstTime("a", 0)).toBe(true);
    expect(d.firstTime("a", 10)).toBe(false);
    expect(d.firstTime("a", 2000)).toBe(true);
  });

  test("debouncer batches bursts per key", async () => {
    const out: [string, number[]][] = [];
    const d = new Debouncer<number>(20, (k, items) => out.push([k, items]));
    d.push("a", 1);
    d.push("a", 2);
    d.push("b", 3);
    await new Promise((r) => setTimeout(r, 50));
    expect(out).toEqual([["a", [1, 2]], ["b", [3]]]);
  });

  test("collectAttachments: small images inline, others as blobs, oversize skipped", async () => {
    const m = msg();
    m.attachments = {
      values: () => [
        { name: "a.png", url: "u1", contentType: "image/png", size: 10 },
        { name: "b.pdf", url: "u2", contentType: "application/pdf", size: 10 },
        { name: "huge.bin", url: "u3", contentType: null, size: 10 ** 9 },
      ],
    };
    const fetched: string[] = [];
    const fetcher = async (u: string) => {
      fetched.push(u);
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode("abc").buffer as ArrayBuffer };
    };
    const { images, files } = await collectAttachments(cfg(), m, fetcher);
    expect(images).toEqual([{ name: "a.png", mediaType: "image/png", base64: "YWJj" }]);
    expect(files.map((f) => [f.name, !!f.data])).toEqual([["b.pdf", true], ["huge.bin", false]]);
    expect(fetched).toEqual(["u1", "u2"]);
  });
});
