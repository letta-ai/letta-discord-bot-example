import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.ts";
import {
  FAILURE_TEXT,
  TurnRenderer,
  type RenderChannel,
  type RenderMessage,
  type RenderPayload,
} from "../src/discord/renderer.ts";

function config(overrides: Partial<Config> = {}): Config {
  return {
    STREAM_EDITS: true,
    STREAM_EDIT_INTERVAL_MS: 1,
    SHOW_TOOL_STATUS: true,
    SHOW_REASONING: false,
    LIFECYCLE_REACTIONS: true,
    ...overrides,
  } as Config;
}

class FakeMessage implements RenderMessage {
  content: string;
  edits: RenderPayload[] = [];
  deleted = false;
  reacted: string[] = [];
  replies: FakeMessage[] = [];
  removedLook = 0;
  reactions = {
    cache: {
      get: (key: string) =>
        key === "👀"
          ? { users: { remove: async () => void this.removedLook++ } }
          : undefined,
    },
  };

  constructor(content = "") {
    this.content = content;
  }

  async edit(options: RenderPayload) {
    this.content = options.content;
    this.edits.push(options);
    return this;
  }
  async delete() {
    this.deleted = true;
    return this;
  }
  async react(emoji: string) {
    this.reacted.push(emoji);
    return this;
  }
  async reply(options: RenderPayload & { failIfNotExists?: boolean }) {
    const msg = new FakeMessage(options.content);
    this.replies.push(msg);
    expect(options.allowedMentions.parse).toEqual([]);
    expect(options.failIfNotExists).toBe(false);
    return msg;
  }
}

class FakeChannel implements RenderChannel {
  sent: FakeMessage[] = [];
  typing = 0;
  constructor(private readonly thread = false) {}
  async send(options: RenderPayload) {
    expect(options.allowedMentions.parse).toEqual([]);
    const msg = new FakeMessage(options.content);
    this.sent.push(msg);
    return msg;
  }
  async sendTyping() {
    this.typing++;
  }
  isThread() {
    return this.thread;
  }
}

describe("TurnRenderer", () => {
  test("streams a reply, splits safely, and completes lifecycle reactions", async () => {
    const channel = new FakeChannel(false);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger, typingIntervalMs: 2 });

    renderer.onEvent({ kind: "started", conversationId: "conv", createdConversation: false });
    renderer.onEvent({ kind: "assistant_delta", text: "x".repeat(2100) });
    renderer.onEvent({ kind: "done", success: true, durationMs: 5 });
    await renderer.finished;

    const replies = [...trigger.replies, ...channel.sent];
    expect(replies.length).toBe(2);
    expect(replies.every((m) => m.content.length <= 2000)).toBe(true);
    expect(replies.map((m) => m.content).join("")).toBe("x".repeat(2100));
    expect(trigger.reacted).toEqual(["👀", "✅"]);
    expect(trigger.removedLook).toBe(1);
    expect(channel.typing).toBeGreaterThanOrEqual(1);
  });

  test("buffers when stream edits are disabled and hides internal failures", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({
      config: config({ STREAM_EDITS: false }),
      channel,
      triggerMessage: trigger,
    });

    renderer.onEvent({ kind: "started", conversationId: "secret-id", createdConversation: true });
    renderer.onEvent({ kind: "error", message: "stack trace with secret-id" });
    renderer.onEvent({ kind: "done", success: false, errorCode: "error", durationMs: 1 });
    await renderer.finished;

    expect(channel.sent.map((m) => m.content)).toEqual([FAILURE_TEXT]);
    expect(channel.sent[0]!.content).not.toContain("secret-id");
    expect(trigger.reacted).toEqual(["👀", "❌"]);
  });

  test("updates and removes one tool status message", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger });

    renderer.onEvent({ kind: "tool_call", toolCallId: "1", toolName: "Bash", summary: "bun test" });
    renderer.onEvent({ kind: "retry", attempt: 2, maxAttempts: 3 });
    renderer.onEvent({ kind: "assistant_delta", text: "done" });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;

    expect(channel.sent.length).toBe(2);
    expect(channel.sent.some((m) => m.content === "done")).toBe(true);
    const status = channel.sent.find((m) => m.content !== "done")!;
    expect(status.deleted).toBe(true);
  });

  test("merged turns render only the redirect reaction", async () => {
    const channel = new FakeChannel();
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger });
    renderer.onEvent({ kind: "merged", intoMessageId: "next" });
    await renderer.finished;
    expect(trigger.reacted).toEqual(["↪️"]);
    expect(channel.sent).toHaveLength(0);
  });
});
