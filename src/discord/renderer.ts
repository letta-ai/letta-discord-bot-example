import type { Config, ReplyMode } from "../config.ts";
import { log } from "../log.ts";
import type { TurnEvent } from "../types.ts";
import { splitForDiscord } from "./split.ts";

/**
 * Renders the normalized TurnEvent stream of one turn into Discord messages:
 * lifecycle reactions, typing indicator, streamed (or one-shot) reply text,
 * optional tool-call lines interleaved with that text in the order they
 * happened, and an optional in-place reasoning line.
 */

type MentionType = "users" | "roles" | "everyone";
export interface RenderPayload {
  content: string;
  allowedMentions: { parse: readonly MentionType[] };
}

/** Narrow view of a discord.js Message. */
export interface RenderMessage {
  edit(options: RenderPayload): Promise<unknown>;
  delete(): Promise<unknown>;
  react(emoji: string): Promise<unknown>;
  reply?(options: RenderPayload & { failIfNotExists?: boolean }): Promise<RenderMessage>;
  reactions?: {
    cache: { get(key: string): { users: { remove(user?: string): Promise<unknown> } } | undefined };
  };
}

/** Narrow view of a discord.js text-based channel. */
export interface RenderChannel {
  send(options: RenderPayload): Promise<RenderMessage>;
  sendTyping(): Promise<unknown>;
  isThread?(): boolean;
}

export interface TurnRendererOptions {
  config: Config;
  channel: RenderChannel;
  triggerMessage: RenderMessage;
  /** Typing refresh interval (Discord typing lasts ~10s). Overridable for tests. */
  typingIntervalMs?: number;
  /**
   * `tool`: the agent speaks only through discord_send_message, so assistant
   * text, typing, tool status, reasoning, and lifecycle reactions are not shown.
   * Failures still are. Defaults to `relay`.
   */
  replyMode?: ReplyMode;
}

export const FAILURE_TEXT =
  "Sorry, something went wrong while answering. Try again, or use /new to start a fresh conversation.";

const NO_MENTIONS = { parse: [] as readonly MentionType[] };
const REASONING_MAX = 180;
const TOOL_BLOCK_MAX = 1900;

export class TurnRenderer {
  readonly finished: Promise<void>;

  private readonly config: Config;
  private readonly channel: RenderChannel;
  private readonly trigger: RenderMessage;
  private readonly typingIntervalMs: number;
  private readonly quiet: boolean; // tool reply mode
  private droppedChars = 0;

  private chain: Promise<void> = Promise.resolve();
  private resolveFinished!: () => void;
  private ended = false;

  // typing
  private typingTimer: ReturnType<typeof setInterval> | null = null;

  // reply text
  // One segment per assistant message; each becomes its own Discord message(s).
  private seg: Segment = newSegment();
  private postedText = false; // any assistant text has been posted this turn
  private textTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTextSync = 0;
  private postedAny = false; // any message (text or failure) has replied to the trigger

  // tool calls: consecutive calls share one message; assistant text in
  // between starts a new one, so the channel reads in event order.
  private toolBlock: ToolBlock | null = null;

  // reasoning line
  private statusMsg: RenderMessage | null = null;
  private statusContent = "";
  private statusCreating = false;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStatusSync = 0;
  private reasoning = "";
  private toolIds = new Set<string>();

  constructor(opts: TurnRendererOptions) {
    this.config = opts.config;
    this.channel = opts.channel;
    this.trigger = opts.triggerMessage;
    this.typingIntervalMs = opts.typingIntervalMs ?? 8000;
    this.quiet = opts.replyMode === "tool";
    this.finished = new Promise<void>((r) => {
      this.resolveFinished = r;
    });
  }

  onEvent(e: TurnEvent): void {
    try {
      this.handle(e);
    } catch (err) {
      log.warn("renderer onEvent failed", { kind: e?.kind, err: String(err) });
    }
  }

  private handle(e: TurnEvent): void {
    if (this.ended) return;
    switch (e.kind) {
      case "started":
        // Typing is the in-progress signal; only the outcome gets a reaction.
        if (!this.quiet) this.startTyping();
        return;
      case "assistant_delta":
        if (!e.text) return;
        if (this.quiet) {
          this.droppedChars += e.text.length;
          return;
        }
        if (e.messageId && this.seg.id && e.messageId !== this.seg.id) this.endSegment();
        if (e.messageId && !this.seg.id) this.seg.id = e.messageId;
        this.toolBlock = null; // tool calls after this text get a new message below it
        this.seg.text += e.text;
        if (this.config.STREAM_EDITS) this.scheduleTextSync();
        return;
      case "reasoning_delta":
        if (this.quiet || !this.config.SHOW_REASONING || !e.text) return;
        this.reasoning += e.text;
        this.scheduleStatusSync();
        return;
      case "tool_call":
        this.toolIds.add(e.toolCallId);
        this.endSegment();
        if (this.quiet || !this.config.SHOW_TOOL_CALLS) return;
        this.reasoning = "";
        this.addToolLine(e.summary || e.toolName);
        return;
      case "retry":
        if (this.quiet || !this.config.SHOW_TOOL_CALLS) return;
        this.addToolLine(`Retrying (attempt ${e.attempt}/${e.maxAttempts})`);
        return;
      case "merged":
        this.ended = true;
        this.stopTyping();
        this.react("↪️");
        this.enqueue(async () => this.resolveFinished());
        return;
      case "done":
        this.ended = true;
        this.finish(e);
        return;
      case "error":
        // Never surfaced to users; the bridge follows up with a failed `done`.
        log.debug("turn error event", { message: e.message });
        return;
      default:
        return;
    }
  }

  // ---- plumbing -----------------------------------------------------------

  private enqueue(fn: () => Promise<unknown> | unknown): void {
    this.chain = this.chain.then(async () => {
      try {
        await fn();
      } catch (err) {
        log.warn("renderer discord call failed", { err: String(err) });
      }
    });
  }

  private react(emoji: string): void {
    if (this.quiet || !this.config.LIFECYCLE_REACTIONS) return;
    this.enqueue(() => this.trigger.react(emoji));
  }

  private startTyping(): void {
    if (this.typingTimer) return;
    // Typing calls share the same chain as sends/edits/reactions. Besides
    // preserving event order, this avoids overlapping REST calls on slow links.
    const tick = () => this.enqueue(() => this.channel.sendTyping());
    tick();
    this.typingTimer = setInterval(tick, this.typingIntervalMs);
    (this.typingTimer as { unref?: () => void }).unref?.();
  }

  private stopTyping(): void {
    if (this.typingTimer) clearInterval(this.typingTimer);
    this.typingTimer = null;
  }

  private interval(): number {
    return Math.max(0, this.config.STREAM_EDIT_INTERVAL_MS);
  }

  // ---- reply text ---------------------------------------------------------

  /** Finalize the current assistant message: post it now and start a fresh segment. */
  private endSegment(): void {
    const done = this.seg;
    if (!done.text) return;
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = null;
    this.enqueue(() => this.syncText(done));
    this.seg = newSegment();
  }

  private scheduleTextSync(): void {
    const seg = this.seg;
    if (!seg.firstSyncQueued) {
      // First visible text goes out immediately.
      if (splitForDiscord(seg.text).length === 0) return;
      seg.firstSyncQueued = true;
      this.lastTextSync = Date.now();
      this.enqueue(() => this.syncText(seg));
      return;
    }
    if (this.textTimer) return;
    const wait = Math.max(0, this.lastTextSync + this.interval() - Date.now());
    this.textTimer = setTimeout(() => {
      this.textTimer = null;
      if (!this.ended) this.enqueue(() => this.syncText(seg));
    }, wait);
  }

  /**
   * Make Discord match splitForDiscord(text): chunk i lives in message i.
   * Earlier chunks are stable once the text has grown past them, so this
   * finalizes full messages and continues in a new one. Idempotent.
   */
  private async syncText(seg: Segment): Promise<void> {
    this.lastTextSync = Date.now();
    const chunks = renderChunks(seg.text);
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i]!;
      const existing = seg.messages[i];
      if (existing) {
        if (existing.content !== content) {
          await existing.msg.edit({ content, allowedMentions: NO_MENTIONS });
          existing.content = content;
        }
      } else {
        const msg = await this.post(content);
        seg.messages.push({ msg, content });
        this.postedText = true;
      }
    }
    // Defensive: drop any surplus messages if the split shrank.
    while (seg.messages.length > chunks.length) {
      const extra = seg.messages.pop()!;
      await extra.msg.delete().catch(() => {});
    }
  }

  /** Post a reply-level message: replies to the trigger first (outside threads). */
  private async post(content: string): Promise<RenderMessage> {
    this.stopTyping();
    const first = !this.postedAny;
    this.postedAny = true;
    const inThread = this.channel.isThread?.() ?? false;
    if (first && !inThread && this.trigger.reply) {
      try {
        return await this.trigger.reply({ content, allowedMentions: NO_MENTIONS, failIfNotExists: false });
      } catch (err) {
        log.debug("reply failed; falling back to send", { err: String(err) });
      }
    }
    return this.channel.send({ content, allowedMentions: NO_MENTIONS });
  }

  // ---- tool calls ---------------------------------------------------------

  private addToolLine(label: string): void {
    const line = `-# ${truncate(label.replace(/\s+/g, " ").trim(), 300)}`;
    let block = this.toolBlock;
    if (!block || block.lines.join("\n").length + line.length + 1 > TOOL_BLOCK_MAX) {
      block = this.toolBlock = { msg: null, content: "", lines: [], queued: false };
    }
    block.lines.push(line);
    if (block.queued) return; // the queued sync renders every line added before it runs
    block.queued = true;
    const b = block;
    this.enqueue(() => this.syncToolBlock(b));
  }

  /** Post or edit a tool block. Not a reply and leaves typing on: the agent is still working. */
  private async syncToolBlock(block: ToolBlock): Promise<void> {
    block.queued = false;
    const content = block.lines.join("\n");
    if (!block.msg) {
      block.msg = await this.channel.send({ content, allowedMentions: NO_MENTIONS });
      block.content = content;
    } else if (content !== block.content) {
      await block.msg.edit({ content, allowedMentions: NO_MENTIONS });
      block.content = content;
    }
  }

  // ---- reasoning line -----------------------------------------------------

  private renderStatus(): string {
    if (!this.config.SHOW_REASONING) return "";
    const r = this.reasoning.replace(/\s+/g, " ").trim();
    return r ? `-# 💭 ${r.length > REASONING_MAX ? `...${r.slice(-REASONING_MAX)}` : r}` : "";
  }

  private scheduleStatusSync(): void {
    if (!this.statusMsg && !this.statusCreating) {
      this.statusCreating = true;
      this.lastStatusSync = Date.now();
      this.enqueue(() => this.syncStatus());
      return;
    }
    if (this.statusTimer) return;
    const wait = Math.max(0, this.lastStatusSync + this.interval() - Date.now());
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      if (!this.ended) this.enqueue(() => this.syncStatus());
    }, wait);
  }

  private async syncStatus(): Promise<void> {
    this.lastStatusSync = Date.now();
    const content = this.renderStatus();
    if (!content) return;
    if (!this.statusMsg) {
      this.statusMsg = await this.channel.send({ content, allowedMentions: NO_MENTIONS });
      this.statusContent = content;
    } else if (content !== this.statusContent) {
      await this.statusMsg.edit({ content, allowedMentions: NO_MENTIONS });
      this.statusContent = content;
    }
  }

  // ---- completion ---------------------------------------------------------

  private finish(e: Extract<TurnEvent, { kind: "done" }>): void {
    this.stopTyping();
    if (this.textTimer) clearTimeout(this.textTimer);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.textTimer = this.statusTimer = null;

    const interrupted = e.errorCode === "interrupted";
    if (this.droppedChars > 0) {
      // Plain text is invisible in tool mode. Logged so an operator can spot a
      // model that writes replies instead of calling discord_send_message.
      log.info("tool mode: assistant text not posted", { chars: this.droppedChars });
    }

    // Deliver whatever text we have (also partial text on failure/interrupt).
    const last = this.seg;
    this.enqueue(() => this.syncText(last));

    if (!e.success && !interrupted) {
      this.enqueue(async () => {
        if (!this.postedText) await this.post(FAILURE_TEXT);
      });
    }

    this.enqueue(async () => {
      if (!this.statusMsg) return;
      const n = this.toolIds.size;
      if (this.postedText || n === 0) {
        await this.statusMsg.delete().catch(() => {});
      } else {
        await this.statusMsg.edit({ content: `-# Used ${n} tool${n === 1 ? "" : "s"}`, allowedMentions: NO_MENTIONS });
      }
    });

    if (this.config.LIFECYCLE_REACTIONS) {
      this.react(interrupted ? "⏹️" : e.success ? "✅" : "❌");
    }

    this.enqueue(async () => this.resolveFinished());
  }
}

interface ToolBlock {
  msg: RenderMessage | null;
  content: string;
  lines: string[];
  queued: boolean;
}

interface Segment {
  id?: string;
  text: string;
  messages: { msg: RenderMessage; content: string }[];
  firstSyncQueued: boolean;
}

function newSegment(): Segment {
  return { text: "", messages: [], firstSyncQueued: false };
}

function renderChunks(text: string): string[] {
  return splitForDiscord(text).map((chunk) => {
    let open = false;
    for (const line of chunk.split("\n")) {
      if (/^\s*```+/.test(line)) open = !open;
    }
    // A streamed delta can end in the middle of a code block. Keep even that
    // transient Discord message balanced; a later edit replaces this sentinel.
    return open ? `${chunk}\n\`\`\`` : chunk;
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}
