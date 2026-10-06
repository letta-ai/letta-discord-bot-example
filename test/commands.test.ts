import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.ts";
import { handleCommand, registerSlashCommands, SLASH_COMMANDS, type CommandInteractionLike } from "../src/discord/commands.ts";
import type { AgentBridge, RouteKey, RouteStatus } from "../src/types.ts";

const route: RouteKey = { guildId: "g", channelId: "c", threadId: null };

function fakeBridge(overrides: Partial<AgentBridge> = {}): AgentBridge {
  return {
    async submit() {},
    async cancel() {
      return false;
    },
    async reset() {
      return "reset" as const;
    },
    async status() {
      return { busy: false, queued: 0, hasConversation: false };
    },
    async shutdown() {},
    ...overrides,
  };
}

function interaction(commandName: string) {
  const replies: { content: string; ephemeral?: boolean }[] = [];
  return {
    value: {
      commandName,
      async reply(options: { content: string; ephemeral?: boolean }) {
        replies.push(options);
      },
    } satisfies CommandInteractionLike,
    replies,
  };
}

function deps(bridge: AgentBridge, admin = false, activeRoute: RouteKey | null = route, allowed = true) {
  return { bridge, routeFor: () => activeRoute, isAdmin: () => admin, mayUse: () => allowed };
}

describe("slash command definitions and registration", () => {
  test("exports only the four DM-capable commands", () => {
    expect(SLASH_COMMANDS.map((command) => command.name)).toEqual(["new", "cancel", "status", "help"]);
    expect(SLASH_COMMANDS.every((command) => command.dm_permission === true)).toBe(true);
  });

  test("registers globally when no guild ids are configured", async () => {
    const calls: unknown[][] = [];
    const client = {
      application: { commands: { set: async (commands: readonly unknown[]) => calls.push([...commands]) } },
      guilds: { fetch: async () => ({ commands: { set: async () => {} } }) },
    };
    await registerSlashCommands(client, { DISCORD_GUILD_IDS: [] } as unknown as Config);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(SLASH_COMMANDS);
  });

  test("registers in every configured guild instead of globally", async () => {
    const guildCalls: string[] = [];
    let globalCalls = 0;
    const client = {
      application: { commands: { set: async () => globalCalls++ } },
      guilds: {
        fetch: async (id: string) => ({ commands: { set: async () => guildCalls.push(id) } }),
      },
    };
    await registerSlashCommands(client, { DISCORD_GUILD_IDS: ["a", "b"] } as unknown as Config);
    expect(guildCalls.sort()).toEqual(["a", "b"]);
    expect(globalCalls).toBe(0);
  });
});

describe("command handling", () => {
  test("returns false for unrelated commands", async () => {
    const i = interaction("model");
    expect(await handleCommand(i.value, deps(fakeBridge()))).toBe(false);
    expect(i.replies).toEqual([]);
  });

  test("rejects known commands outside active routes", async () => {
    const i = interaction("help");
    expect(await handleCommand(i.value, deps(fakeBridge(), false, null))).toBe(true);
    expect(i.replies).toEqual([{ content: "This command only works where the bot is active.", ephemeral: true }]);
  });

  test("refuses /new, /cancel and /status to users the gate would reject", async () => {
    const touched: string[] = [];
    const bridge = fakeBridge({
      async reset() {
        touched.push("reset");
        return "reset" as const;
      },
      async cancel() {
        touched.push("cancel");
        return true;
      },
      async status() {
        touched.push("status");
        return { busy: false, queued: 0, hasConversation: false };
      },
    });
    for (const name of ["new", "cancel", "status"]) {
      const i = interaction(name);
      expect(await handleCommand(i.value, deps(bridge, false, route, false))).toBe(true);
      expect(i.replies).toEqual([{ content: "You can't use the bot here.", ephemeral: true }]);
    }
    expect(touched).toEqual([]);

    const help = interaction("help");
    await handleCommand(help.value, deps(bridge, false, route, false));
    expect(help.replies[0]?.content).toContain("Commands:");
  });

  test("resets a route publicly", async () => {
    let resetRoute: RouteKey | undefined;
    const i = interaction("new");
    await handleCommand(
      i.value,
      deps(
        fakeBridge({
          async reset(value) {
            resetRoute = value;
            return "reset" as const;
          },
        }),
      ),
    );
    expect(resetRoute).toEqual(route);
    expect(i.replies).toEqual([
      { content: "Started a fresh conversation here. The agent still remembers what it has learned." },
    ]);
  });

  test("reports cancel results ephemerally", async () => {
    for (const [cancelled, expected] of [[true, "Cancelled."], [false, "Nothing to cancel."]] as const) {
      const i = interaction("cancel");
      await handleCommand(i.value, deps(fakeBridge({ async cancel() { return cancelled; } })));
      expect(i.replies).toEqual([{ content: expected, ephemeral: true }]);
    }
  });

  test("keeps ids and model out of non-admin status", async () => {
    const status: RouteStatus = {
      busy: true,
      queued: 2,
      hasConversation: true,
      conversationId: "conv-secret",
      model: "secret-model",
      lastActiveAt: "2026-01-02T03:04:05.000Z",
    };
    const adminFlags: boolean[] = [];
    const bridge = fakeBridge({
      async status(_route, admin) {
        adminFlags.push(admin);
        return status;
      },
    });
    const i = interaction("status");
    await handleCommand(i.value, deps(bridge));
    expect(adminFlags).toEqual([false]);
    expect(i.replies[0]!.content).toContain("Status: busy");
    expect(i.replies[0]!.content).toContain("Queued: 2");
    expect(i.replies[0]!.content).not.toContain("conv-secret");
    expect(i.replies[0]!.content).not.toContain("secret-model");
    expect(i.replies[0]!.ephemeral).toBe(true);
  });

  test("shows ids and model to admins", async () => {
    const i = interaction("status");
    await handleCommand(
      i.value,
      deps(
        fakeBridge({
          async status() {
            return { busy: false, queued: 0, hasConversation: true, conversationId: "conv-1", model: "model-1" };
          },
        }),
        true,
      ),
    );
    expect(i.replies[0]!.content).toContain("Conversation ID: conv-1");
    expect(i.replies[0]!.content).toContain("Model: model-1");
  });

  test("help explains Discord usage and operator-owned settings", async () => {
    const i = interaction("help");
    await handleCommand(i.value, deps(fakeBridge()));
    expect(i.replies[0]!.ephemeral).toBe(true);
    expect(i.replies[0]!.content).toContain("Mention the bot");
    expect(i.replies[0]!.content).toContain("attach images or files");
    expect(i.replies[0]!.content).toContain("managed by its operator in Letta");
  });
});

test("/new refuses on a pinned route and /status names the rule", async () => {
  const bridge = fakeBridge({
    async reset() {
      return "pinned" as const;
    },
    async status() {
      return { busy: false, queued: 0, hasConversation: true, pinnedBy: "channel:111" };
    },
  });
  const n = interaction("new");
  await handleCommand(n.value, deps(bridge));
  expect(n.replies).toEqual([
    { content: "This channel is pinned to a conversation by the routing table, so /new is disabled here.", ephemeral: true },
  ]);
  const st = interaction("status");
  await handleCommand(st.value, deps(bridge));
  expect(st.replies[0]!.content).toContain("Conversation: pinned (channel:111)");
});
