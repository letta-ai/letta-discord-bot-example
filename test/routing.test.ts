import { describe, expect, test } from "bun:test";
import { parseRoutingTable, pinnedConversations, resolveRoute } from "../src/routing.ts";
import type { RouteKey } from "../src/types.ts";

const table = parseRoutingTable(
  JSON.stringify({
    routes: [
      { thread: "12", conversation: "conv-thread" },
      { channel: "1", conversation: "conv-channel" },
      { channel: "2", conversation: "auto" },
      { dm: "7", conversation: "default" },
      { guild: "9", conversation: "conv-guild" },
    ],
  }),
);

const g = (channelId: string, threadId: string | null = null, guildId = "9"): RouteKey => ({ guildId, channelId, threadId });

describe("resolveRoute", () => {
  test("most specific rule wins", () => {
    expect(resolveRoute(table, g("1", "12"))).toEqual({ kind: "pinned", conversationId: "conv-thread", rule: "thread:12" });
    expect(resolveRoute(table, g("1", "13"))).toEqual({ kind: "pinned", conversationId: "conv-channel", rule: "channel:1" });
    expect(resolveRoute(table, g("1"))).toMatchObject({ conversationId: "conv-channel" });
    expect(resolveRoute(table, g("3"))).toEqual({ kind: "pinned", conversationId: "conv-guild", rule: "guild:9" });
  });

  test("auto exempts a channel from a broader pin", () => {
    expect(resolveRoute(table, g("2"))).toEqual({ kind: "auto" });
    expect(resolveRoute(table, g("2", "21"))).toEqual({ kind: "auto" });
  });

  test("DMs match by user, never by channel or guild rules", () => {
    expect(resolveRoute(table, { guildId: null, channelId: "1", threadId: null, userId: "7" })).toEqual({
      kind: "pinned",
      conversationId: "default",
      rule: "dm:7",
    });
    expect(resolveRoute(table, { guildId: null, channelId: "1", threadId: null, userId: "8" })).toEqual({ kind: "auto" });
  });

  test("fallback covers everything unmatched; no table means auto", () => {
    const withFallback = parseRoutingTable(JSON.stringify({ routes: [{ channel: "2", conversation: "auto" }], fallback: "default" }));
    expect(resolveRoute(withFallback, g("5", null, "x"))).toEqual({ kind: "pinned", conversationId: "default", rule: "fallback" });
    expect(resolveRoute(withFallback, { guildId: null, channelId: "d", threadId: null, userId: "8" })).toMatchObject({ conversationId: "default" });
    expect(resolveRoute(withFallback, g("2"))).toEqual({ kind: "auto" });
    expect(resolveRoute(null, g("1"))).toEqual({ kind: "auto" });
  });

  test("pinnedConversations lists distinct targets", () => {
    expect(pinnedConversations(table)).toEqual(["conv-thread", "conv-channel", "default", "conv-guild"]);
  });
});

describe("parseRoutingTable", () => {
  const bad = (value: unknown) => () => parseRoutingTable(JSON.stringify(value), "routes.json");

  test("rejects malformed tables with a readable error", () => {
    expect(() => parseRoutingTable("{", "routes.json")).toThrow(/routes.json: invalid JSON/);
    expect(bad({ routes: [{ channel: "1", conversation: "agent-123" }] })).toThrow(/conversation id/);
    expect(bad({ routes: [{ channel: "abc", conversation: "conv-x" }] })).toThrow(/snowflake/);
    expect(bad({ routes: [{ channel: "1", thread: "2", conversation: "conv-x" }] })).toThrow(/routes.json/);
    expect(bad({ routes: [{ room: "1", conversation: "conv-x" }] })).toThrow(/routes.json/);
    expect(bad({ routes: [], extra: true })).toThrow(/routes.json/);
    expect(
      bad({
        routes: [
          { channel: "1", conversation: "conv-x" },
          { channel: "1", conversation: "conv-y" },
        ],
      }),
    ).toThrow(/duplicate channel 1/);
  });
});
