import { describe, expect, test } from "bun:test";
import { GatewayIntentBits } from "discord.js";
import { loadConfig } from "../src/config.ts";
import { createDiscordClient } from "../src/discord/gateway.ts";
import { gate, type IngressMessage } from "../src/discord/ingress.ts";
import { checkMessageContentIntent } from "../src/doctor.ts";

const BOT = "999";
const base = { DISCORD_BOT_TOKEN: "x", LETTA_API_KEY: "y", LETTA_AGENT_ID: "agent-1" };
const cfg = (extra: Record<string, string> = {}) => loadConfig({ ...base, ...extra });

function msg(o: { thread?: boolean; mentioned?: boolean; channelId?: string; parentId?: string }): IngressMessage {
  const thread = o.thread ?? false;
  return {
    id: "m1",
    content: "",
    createdAt: new Date(0),
    guildId: "g1",
    author: { id: "u1", bot: false, username: "ann" },
    member: { displayName: "Ann", roles: { cache: { has: () => false } } },
    channel: { id: o.channelId ?? "c1", isThread: () => thread, isDMBased: () => false, parentId: o.parentId ?? "c1" },
    mentions: { users: { has: (id: string) => (o.mentioned ?? false) && id === BOT } },
    attachments: { values: () => [] },
  };
}
const deps = { botUserId: BOT, isBotThread: (id: string) => id === "t1", hasRoute: () => false };

describe("DISCORD_MESSAGE_CONTENT_INTENT", () => {
  test("defaults on and requests the intent", () => {
    expect(cfg().DISCORD_MESSAGE_CONTENT_INTENT).toBe(true);
    expect(createDiscordClient(cfg()).options.intents.has(GatewayIntentBits.MessageContent)).toBe(true);
  });

  test("=false does not request the privileged intent", () => {
    const intents = createDiscordClient(cfg({ DISCORD_MESSAGE_CONTENT_INTENT: "false" })).options.intents;
    expect(intents.has(GatewayIntentBits.MessageContent)).toBe(false);
    expect(intents.has(GatewayIntentBits.GuildMessages)).toBe(true);
    expect(intents.has(GatewayIntentBits.DirectMessages)).toBe(true);
  });

  test("without the intent, unaddressed messages in the bot's own thread are ignored", () => {
    const c = cfg({ DISCORD_MESSAGE_CONTENT_INTENT: "false" });
    expect(gate(c, msg({ thread: true, channelId: "t1" }), deps)).toMatchObject({ accept: false });
    expect(gate(c, msg({ thread: true, channelId: "t1", mentioned: true }), deps).accept).toBe(true);
    // With the intent, follow-ups in the bot's thread still need no mention.
    expect(gate(cfg(), msg({ thread: true, channelId: "t1" }), deps).accept).toBe(true);
  });

  test("without the intent, open channels still need a mention", () => {
    const c = cfg({ DISCORD_MESSAGE_CONTENT_INTENT: "false", DISCORD_OPEN_CHANNEL_IDS: "c1" });
    expect(gate(c, msg({}), deps)).toMatchObject({ accept: false });
    expect(gate(c, msg({ mentioned: true }), deps).accept).toBe(true);
  });

  test("doctor warns instead of failing when the intent is not requested", () => {
    expect(checkMessageContentIntent(0, false).status).toBe("WARN");
    expect(checkMessageContentIntent(0).status).toBe("FAIL");
    expect(checkMessageContentIntent(1 << 18, false).status).toBe("PASS");
  });
});
