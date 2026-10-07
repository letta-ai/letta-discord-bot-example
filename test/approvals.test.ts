import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.ts";
import {
  ApprovalManager,
  previewInput,
  type ApprovalChannel,
  type ApprovalInteraction,
  type ApprovalMessage,
  type ApprovalPayload,
} from "../src/discord/approvals.ts";
import type { ApprovalRequest } from "../src/types.ts";

function config(overrides: Partial<Config> = {}): Config {
  return {
    APPROVAL_MODE: "admins",
    APPROVAL_TIMEOUT_SECONDS: 1,
    DISCORD_ADMIN_USER_IDS: ["admin"],
    DISCORD_ADMIN_ROLE_IDS: [],
    ...overrides,
  } as Config;
}

const request = (requesterId = "requester"): ApprovalRequest => ({
  route: { guildId: "g", channelId: "c", threadId: null },
  requesterId,
  toolName: "Bash",
  toolInput: { command: "printf `unsafe`", long: "x".repeat(1000) },
  toolCallId: "tc",
});

/** All human-visible text in a payload: content plus embed title/description/fields/footer. */
function text(p: ApprovalPayload): string {
  const parts = [p.content ?? ""];
  for (const e of p.embeds ?? []) {
    parts.push(e.title ?? "", e.description ?? "", e.footer?.text ?? "");
    for (const f of e.fields ?? []) parts.push(f.name, f.value);
  }
  return parts.join("\n");
}

class FakeMessage implements ApprovalMessage {
  edits: ApprovalPayload[] = [];
  constructor(public payload: ApprovalPayload) {}
  async edit(options: ApprovalPayload) {
    this.payload = options;
    this.edits.push(options);
    return this;
  }
}

class FakeChannel implements ApprovalChannel {
  sent: FakeMessage[] = [];
  async send(options: ApprovalPayload) {
    expect(options.allowedMentions.parse).toEqual([]);
    const message = new FakeMessage(options);
    this.sent.push(message);
    return message;
  }
}

class FakeInteraction implements ApprovalInteraction {
  replies: { content: string; flags: number }[] = [];
  updates: ApprovalPayload[] = [];
  member?: { roles?: unknown };
  constructor(
    public customId: string,
    public user: { id: string },
    roles?: unknown,
  ) {
    this.member = roles === undefined ? undefined : { roles };
  }
  async reply(options: { content: string; flags: number; allowedMentions: ApprovalPayload["allowedMentions"] }) {
    expect(options.allowedMentions.parse).toEqual([]);
    this.replies.push(options);
  }
  async update(options: ApprovalPayload) {
    expect(options.allowedMentions.parse).toEqual([]);
    this.updates.push(options);
  }
}

function customId(channel: FakeChannel, action: "approve" | "deny") {
  const components = channel.sent[0]!.payload.components[0]!.components;
  return components.find((c) => c.label.toLowerCase() === action)!.custom_id;
}

describe("ApprovalManager", () => {
  test("allow, deny, and admins without any admins return without posting", async () => {
    const channel = new FakeChannel();
    const noAdmins = new ApprovalManager({ config: config({ DISCORD_ADMIN_USER_IDS: [] }) });
    const sent: unknown[] = [];
    const decision = await noAdmins.request({ send: async (p: unknown) => (sent.push(p), {} as never) } as never, request(), () => false);
    expect(decision.allow).toBe(false);
    expect(decision.message).toContain("no admins configured");
    expect(sent).toHaveLength(0); // no buttons nobody could click

    const allow = new ApprovalManager({ config: config({ APPROVAL_MODE: "allow" }) });
    const deny = new ApprovalManager({ config: config({ APPROVAL_MODE: "deny" }) });
    expect(await allow.request(channel, request(), () => false)).toEqual({ allow: true });
    expect((await deny.request(channel, request(), () => false)).allow).toBe(false);
    expect(channel.sent).toHaveLength(0);
  });

  test("renders a readable embed: description as title, command as a bash block, other args as fields", async () => {
    const channel = new FakeChannel();
    const manager = new ApprovalManager({ config: config({ APPROVAL_TIMEOUT_SECONDS: 300 }) });
    void manager.request(
      channel,
      {
        ...request(),
        toolInput: { command: "cd /tmp/vid && ffmpeg -i luna.mp4 mid.png", description: "Extract a downscaled middle frame", timeout: 60000 },
      },
      () => false,
    );
    await Promise.resolve();
    const payload = channel.sent[0]!.payload;
    const embed = payload.embeds![0]!;
    expect(embed.title).toBe("Extract a downscaled middle frame");
    expect(embed.description).toContain("```bash\ncd /tmp/vid && ffmpeg -i luna.mp4 mid.png\n```");
    expect(text(payload)).not.toContain('"command"');
    expect(embed.fields).toEqual([{ name: "timeout", value: "`60000`", inline: true }]);
    expect(embed.footer!.text).toContain("Bash");
    expect(embed.footer!.text).toContain("5 min");
    expect(embed.color).toBe(0x5865f2);
  });

  test("enforces admin policy and disables buttons after approval", async () => {
    const channel = new FakeChannel();
    const manager = new ApprovalManager({ config: config() });
    const decision = manager.request(channel, request(), (id, roles) => id === "admin" || !!roles?.has("admin-role"));
    await Promise.resolve();

    expect(channel.sent).toHaveLength(1);
    expect(text(channel.sent[0]!.payload)).toContain("Bash");
    expect(text(channel.sent[0]!.payload)).not.toContain("```unsafe```");

    const forbidden = new FakeInteraction(customId(channel, "approve"), { id: "requester" });
    expect(await manager.handleInteraction(forbidden)).toBe(true);
    expect(forbidden.replies[0]!.content).toBe("You can't approve this.");

    const approved = new FakeInteraction(customId(channel, "approve"), { id: "admin" });
    expect(await manager.handleInteraction(approved)).toBe(true);
    expect(await decision).toEqual({ allow: true, decidedBy: "admin" });
    expect(text(approved.updates[0]!)).toContain("Approved by <@admin>");
    expect(approved.updates[0]!.components[0]!.components.every((b) => b.disabled)).toBe(true);
  });

  test("requester mode accepts the requester and timeout denies", async () => {
    const requesterChannel = new FakeChannel();
    const requesterManager = new ApprovalManager({ config: config({ APPROVAL_MODE: "requester" }) });
    const requesterDecision = requesterManager.request(requesterChannel, request("u1"), () => false);
    await Promise.resolve();
    const denied = new FakeInteraction(customId(requesterChannel, "deny"), { id: "u1" });
    await requesterManager.handleInteraction(denied);
    expect((await requesterDecision).allow).toBe(false);
    expect(text(denied.updates[0]!)).toContain("Denied by <@u1>");

    const timeoutChannel = new FakeChannel();
    const timeoutManager = new ApprovalManager({
      config: config({ APPROVAL_TIMEOUT_SECONDS: 0.005 }),
    });
    const timed = timeoutManager.request(timeoutChannel, request(), () => false);
    const result = await timed;
    expect(result).toEqual({ allow: false, message: "Approval timed out" });
    expect(text(timeoutChannel.sent[0]!.edits.at(-1)!)).toContain("Approval timed out");
  });

  test("cancelAll denies all pending requests", async () => {
    const channel = new FakeChannel();
    const manager = new ApprovalManager({ config: config() });
    const pending = manager.request(channel, request(), () => true);
    await Promise.resolve();
    await manager.cancelAll();
    expect((await pending).allow).toBe(false);
    expect(text(channel.sent[0]!.edits.at(-1)!)).toContain("Approval cancelled");
  });

  test("preview is compact and neutralizes backticks", () => {
    const preview = previewInput({ value: "`".repeat(1000) });
    expect(preview.length).toBeLessThanOrEqual(802);
    expect(preview).toContain("`\u200b");
  });
});
