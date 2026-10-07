import { describe, expect, test } from "bun:test";
import { parseRoutingTable, pinnedConversations, policyFor, resolveRoute } from "../src/routing.ts";
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

describe("policyFor", () => {
  const env = { ALLOWED_TOOLS: [] as string[], TOOLSET_BASE: undefined, PERMISSION_MODE: "unrestricted" as const, APPROVAL_MODE: "allow" as const };
  const t = parseRoutingTable(
    JSON.stringify({
      policy: { permissionMode: "standard" },
      routes: [
        { guild: "9", policy: { toolset: "none", allowedTools: ["Read"] } },
        { channel: "1", conversation: "conv-channel", policy: { approvalMode: "requester" } },
        { thread: "12", policy: { allowedTools: [] } },
        { dm: "7", policy: { approvalMode: "admins", permissionMode: "strict" } },
      ],
    }),
  );

  test("no table means the env settings", () => {
    expect(policyFor(env, null, g("1"))).toEqual({ allowedTools: [], permissionMode: "unrestricted", approvalMode: "allow" });
  });

  test("each field comes from the most specific entry that sets it, then the table policy, then env", () => {
    expect(policyFor(env, t, g("1"))).toEqual({ allowedTools: ["Read"], toolset: "none", permissionMode: "standard", approvalMode: "requester" });
    // The thread resets the allowlist but keeps the guild toolset and the channel approval mode.
    expect(policyFor(env, t, g("1", "12"))).toEqual({ allowedTools: [], toolset: "none", permissionMode: "standard", approvalMode: "requester" });
    expect(policyFor(env, t, g("5", null, "8"))).toEqual({ allowedTools: [], permissionMode: "standard", approvalMode: "allow" });
    expect(policyFor(env, t, { guildId: null, channelId: "d", threadId: null, userId: "7" })).toEqual({
      allowedTools: [],
      permissionMode: "strict",
      approvalMode: "admins",
    });
  });

  test("a policy-only entry leaves the conversation to less specific rules", () => {
    expect(resolveRoute(t, g("1", "12"))).toEqual({ kind: "pinned", conversationId: "conv-channel", rule: "channel:1" });
    expect(resolveRoute(t, g("3"))).toEqual({ kind: "auto" });
    expect(pinnedConversations(t)).toEqual(["conv-channel"]);
  });

  test("rejects an empty entry and unknown policy keys", () => {
    expect(() => parseRoutingTable(JSON.stringify({ routes: [{ channel: "1" }] }))).toThrow(/needs a conversation, a policy, or both/);
    expect(() => parseRoutingTable(JSON.stringify({ routes: [{ channel: "1", policy: { deniedTools: ["Bash"] } }] }))).toThrow();
    expect(() => parseRoutingTable(JSON.stringify({ policy: { toolset: "everything" } }))).toThrow();
  });
});
