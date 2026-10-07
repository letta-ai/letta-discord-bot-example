import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.ts";
import {
  FAILURE_TEXT,
  TurnRenderer,
  formatDuration,
  type CardPayload,
  type RenderChannel,
  type RenderMessage,
  type RenderPayload,
} from "../src/discord/renderer.ts";

type AnyPayload = RenderPayload | CardPayload;
interface Card {
  accent: number;
  text: string;
}
/** Text of a payload: plain content, or a card's TextDisplay content. */
function cardOf(p: AnyPayload): Card | null {
  if (!("components" in p)) return null;
  expect(p.flags).toBe(1 << 15);
  const container = p.components[0] as { type: number; accent_color: number; components: { type: number; content: string }[] };
  expect(container.type).toBe(17);
  return { accent: container.accent_color, text: container.components.map((c) => c.content).join("\n") };
}
function textOf(p: AnyPayload): string {
  return "components" in p ? `[card] ${cardOf(p)!.text}` : p.content;
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    STREAM_EDITS: true,
    STREAM_EDIT_INTERVAL_MS: 1,
    SHOW_TOOL_CALLS: true,
    SHOW_REASONING: false,
    LIFECYCLE_REACTIONS: true,
    ...overrides,
  } as Config;
}

class FakeMessage implements RenderMessage {
  content: string;
  card: Card | null = null;
  edits: AnyPayload[] = [];
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

  async edit(options: AnyPayload) {
    this.content = textOf(options);
    this.card = cardOf(options);
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
  rejectCards = false;
  constructor(private readonly thread = false) {}
  async send(options: AnyPayload) {
    expect(options.allowedMentions.parse).toEqual([]);
    if (this.rejectCards && "components" in options) throw new Error("Invalid Form Body");
    const msg = new FakeMessage(textOf(options));
    msg.card = cardOf(options);
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
  test("tool reply mode posts no assistant text, typing, tool status, or reactions", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({
      config: config({ STREAM_EDITS: true, SHOW_REASONING: true, LIFECYCLE_REACTIONS: true }),
      channel,
      triggerMessage: trigger,
      typingIntervalMs: 2,
      replyMode: "tool",
    });

    renderer.onEvent({ kind: "started", conversationId: "c", createdConversation: false });
    renderer.onEvent({ kind: "reasoning_delta", text: "Should I chime in?" });
    renderer.onEvent({ kind: "assistant_delta", text: "Thinking out loud.", messageId: "message-a" });
    renderer.onEvent({ kind: "tool_call", toolCallId: "t1", toolName: "discord_send_message", summary: "Send" });
    renderer.onEvent({ kind: "tool_result", toolCallId: "t1", isError: false });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;

    expect([...trigger.replies, ...channel.sent]).toEqual([]);
    expect(channel.typing).toBe(0);
    expect(trigger.reacted).toEqual([]);
  });

  test("tool reply mode still reports a failed turn", async () => {
    const channel = new FakeChannel(false);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger, replyMode: "tool" });

    renderer.onEvent({ kind: "started", conversationId: "c", createdConversation: false });
    renderer.onEvent({ kind: "done", success: false, durationMs: 1, errorCode: "boom" });
    await renderer.finished;

    expect([...trigger.replies, ...channel.sent].map((m) => m.content)).toEqual([FAILURE_TEXT]);
  });

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
    expect(trigger.reacted).toEqual(["✅"]);
    expect(trigger.removedLook).toBe(0); // no 👀 to clean up
    expect(channel.typing).toBeGreaterThanOrEqual(1);
  });

  test("posts each assistant message as it finalizes instead of smushing them together", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config({ STREAM_EDITS: false }), channel, triggerMessage: trigger });
    const texts = () => channel.sent.map((m) => m.content).filter((c) => !c.startsWith("[card]"));

    renderer.onEvent({ kind: "started", conversationId: "c", createdConversation: false });
    renderer.onEvent({ kind: "assistant_delta", text: "Not saved locally, ", messageId: "message-a" });
    renderer.onEvent({ kind: "assistant_delta", text: "so I'll fetch it.", messageId: "message-a" });
    renderer.onEvent({ kind: "tool_call", toolCallId: "t1", toolName: "Bash", summary: "Download the video" });
    await new Promise((r) => setTimeout(r, 20));
    // The first message is posted when the tool call ends it, before the turn finishes.
    expect(texts()).toEqual(["Not saved locally, so I'll fetch it."]);

    renderer.onEvent({ kind: "tool_result", toolCallId: "t1", isError: false });
    renderer.onEvent({ kind: "assistant_delta", text: "Yes. ", messageId: "message-b" });
    renderer.onEvent({ kind: "assistant_delta", text: "Downloaded it.", messageId: "message-b" });
    renderer.onEvent({ kind: "assistant_delta", text: "Second thought.", messageId: "message-c" });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;

    expect(texts()).toEqual(["Not saved locally, so I'll fetch it.", "Yes. Downloaded it.", "Second thought."]);
    expect(trigger.reacted).toEqual(["✅"]);
  });

  test("deltas without a message id continue the current message", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config({ STREAM_EDITS: false }), channel, triggerMessage: trigger });
    renderer.onEvent({ kind: "assistant_delta", text: "one ", messageId: "message-a" });
    renderer.onEvent({ kind: "assistant_delta", text: "two" });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;
    expect(channel.sent.map((m) => m.content)).toEqual(["one two"]);
  });

  test("streaming mode also starts a new Discord message per assistant message", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({
      config: config({ STREAM_EDITS: true, STREAM_EDIT_INTERVAL_MS: 0 }),
      channel,
      triggerMessage: trigger,
    });
    renderer.onEvent({ kind: "assistant_delta", text: "first", messageId: "message-a" });
    await new Promise((r) => setTimeout(r, 10));
    renderer.onEvent({ kind: "assistant_delta", text: "second", messageId: "message-b" });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;
    expect(channel.sent.map((m) => m.content)).toEqual(["first", "second"]);
  });

  test("with stream edits disabled, posts the full reply once with no edits", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config({ STREAM_EDITS: false }), channel, triggerMessage: trigger });

    renderer.onEvent({ kind: "started", conversationId: "c", createdConversation: false });
    for (const t of ["Hello", ", ", "world", "!"]) {
      renderer.onEvent({ kind: "assistant_delta", text: t });
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(channel.sent.length).toBe(0);
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;

    expect(channel.sent.map((m) => m.content)).toEqual(["Hello, world!"]);
    expect(channel.sent[0]!.edits.length).toBe(0);
    expect(trigger.reacted).toEqual(["✅"]);
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
    expect(trigger.reacted).toEqual(["❌"]);
  });

  test("interleaves tool cards with assistant messages in event order", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    let t = 0;
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger, now: () => t });

    renderer.onEvent({ kind: "assistant_delta", text: "Let me look.", messageId: "a1" });
    renderer.onEvent({ kind: "tool_call", toolCallId: "1", toolName: "Grep", summary: "Search memory" });
    t = 400;
    renderer.onEvent({ kind: "tool_result", toolCallId: "1", isError: false });
    renderer.onEvent({ kind: "tool_call", toolCallId: "2", toolName: "Read", summary: "Read notes.md" });
    t = 1600;
    renderer.onEvent({ kind: "tool_result", toolCallId: "2", isError: false });
    renderer.onEvent({ kind: "assistant_delta", text: "Found it.", messageId: "a2" });
    renderer.onEvent({ kind: "tool_call", toolCallId: "3", toolName: "Bash", summary: "bun test" });
    renderer.onEvent({ kind: "retry", attempt: 2, maxAttempts: 3 });
    t = 2000;
    renderer.onEvent({ kind: "tool_result", toolCallId: "3", isError: false });
    renderer.onEvent({ kind: "assistant_delta", text: "Done.", messageId: "a3" });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;

    expect(channel.sent.map((m) => m.content)).toEqual([
      "Let me look.",
      "[card] ✓ Search memory · 0.4s\n✓ Read notes.md · 1.2s", // consecutive calls share a card
      "Found it.",
      "[card] ✓ bun test · 0.4s\n↻ Retrying (attempt 2/3)",
      "Done.",
    ]);
    expect(channel.sent[1]!.card!.accent).toBe(0x57f287);
    expect(channel.sent.some((m) => m.deleted)).toBe(false); // the record stays
  });

  test("a running call shows as running, and a failed call turns the card red", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    let t = 0;
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger, now: () => t });

    renderer.onEvent({ kind: "tool_call", toolCallId: "1", toolName: "Bash", summary: "bun test" });
    await new Promise((r) => setTimeout(r, 10));
    expect(channel.sent[0]!.card).toEqual({ accent: 0x80848e, text: "◌ bun test" });

    t = 2500;
    renderer.onEvent({ kind: "tool_result", toolCallId: "1", isError: true });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;
    expect(channel.sent[0]!.card).toEqual({ accent: 0xed4245, text: "✗ bun test · 2.5s" });
  });

  test("calls without a result are marked stopped when the turn ends", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger, now: () => 0 });

    renderer.onEvent({ kind: "tool_call", toolCallId: "1", toolName: "Bash", summary: "sleep 600" });
    renderer.onEvent({ kind: "done", success: false, errorCode: "interrupted", durationMs: 1 });
    await renderer.finished;
    expect(channel.sent[0]!.card!.text).toBe("■ sleep 600");
  });

  test("falls back to plain subtext lines if Discord rejects the card", async () => {
    const channel = new FakeChannel(true);
    channel.rejectCards = true;
    const trigger = new FakeMessage();
    let t = 0;
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger, now: () => t });

    renderer.onEvent({ kind: "tool_call", toolCallId: "1", toolName: "Bash", summary: "bun test" });
    t = 300;
    renderer.onEvent({ kind: "tool_result", toolCallId: "1", isError: false });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;
    expect(channel.sent.map((m) => m.content)).toEqual(["-# ✓ bun test · 0.3s"]);
  });

  test("formats durations", () => {
    expect([50, 400, 12_340, 61_000, 3_725_000].map(formatDuration)).toEqual(["<0.1s", "0.4s", "12.3s", "1m 1s", "62m 5s"]);
  });

  test("tool calls are hidden unless SHOW_TOOL_CALLS is on", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config({ SHOW_TOOL_CALLS: false }), channel, triggerMessage: trigger });

    renderer.onEvent({ kind: "assistant_delta", text: "One.", messageId: "a1" });
    renderer.onEvent({ kind: "tool_call", toolCallId: "1", toolName: "Bash", summary: "bun test" });
    renderer.onEvent({ kind: "assistant_delta", text: "Two.", messageId: "a2" });
    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;

    expect(channel.sent.map((m) => m.content)).toEqual(["One.", "Two."]);
  });

  test("tool card shows only the label, no wrench or tool name", async () => {
    const channel = new FakeChannel(true);
    const trigger = new FakeMessage();
    const renderer = new TurnRenderer({ config: config(), channel, triggerMessage: trigger });

    renderer.onEvent({ kind: "tool_call", toolCallId: "1", toolName: "Bash", summary: "Check system info" });
    await new Promise((r) => setTimeout(r, 20));
    expect(channel.sent.map((m) => m.content)).toContain("[card] ◌ Check system info");

    renderer.onEvent({ kind: "done", success: true, durationMs: 1 });
    await renderer.finished;
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
