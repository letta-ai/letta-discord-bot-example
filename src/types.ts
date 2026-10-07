/**
 * Shared contract between the Discord layer (src/discord/**) and the Letta
 * layer (src/letta/**). Neither side imports the other's internals; both
 * depend only on this file, src/config.ts, and src/log.ts.
 */
import type { AnyAgentTool, SendMessage } from "@letta-ai/letta-agent-sdk";

/** Stable routing key for one Discord conversation surface. */
export interface RouteKey {
  guildId: string | null; // null for DMs
  channelId: string; // parent channel (or DM channel)
  threadId: string | null; // thread id when the surface is a thread
  userId?: string; // DMs: the other user. Used by routing-table `dm` rules, not part of the key.
}

export function routeKeyString(k: RouteKey): string {
  return `${k.guildId ?? "dm"}:${k.channelId}:${k.threadId ?? "-"}`;
}

/** One inbound Discord message, already gated and normalized. */
export interface InboundMessage {
  route: RouteKey;
  messageId: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  text: string; // mention of the bot stripped
  createdAt: string; // ISO
  replyToMessageId?: string;
  replyTo?: ReplyTarget; // the replied-to message, when it could be fetched
  images: InboundImage[]; // small images, sent as multimodal content
  files: InboundFile[]; // everything else, uploaded into the sandbox
}

/** The message a Discord reply points at, so the agent need not look it up. */
export interface ReplyTarget {
  messageId: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  own: boolean; // written by this bot
  text: string; // excerpt, capped at REPLY_EXCERPT_MAX
}

export interface InboundImage {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
}

export interface InboundFile {
  name: string;
  url: string; // Discord CDN url
  contentType: string | null;
  size: number;
  data?: Blob; // filled by ingress when <= MAX_FILE_BYTES
  voice?: boolean; // Discord voice message
  durationSecs?: number;
  transcript?: string; // speech-to-text result for audio
  transcriptProvider?: string;
  transcriptModel?: string;
  transcriptError?: string;
}

/** Normalized events emitted while a turn runs. */
export type TurnEvent =
  | { kind: "started"; conversationId: string; createdConversation: boolean }
  | { kind: "assistant_delta"; text: string; messageId?: string } // append-only fragment; messageId marks message boundaries
  | { kind: "reasoning_delta"; text: string }
  | { kind: "tool_call"; toolCallId: string; toolName: string; summary: string }
  | { kind: "tool_result"; toolCallId: string; isError: boolean }
  | { kind: "retry"; attempt: number; maxAttempts: number }
  | { kind: "files_uploaded"; paths: string[] }
  /** This message arrived mid-turn and was merged into a later turn. */
  | { kind: "merged"; intoMessageId: string }
  | { kind: "done"; success: boolean; errorCode?: string; durationMs: number }
  | { kind: "error"; message: string };

/** Approval request surfaced from the SDK canUseTool callback. */
export interface ApprovalRequest {
  route: RouteKey;
  requesterId: string; // Discord user who triggered the turn
  toolName: string;
  toolInput: Record<string, unknown>;
  toolCallId?: string;
  /** The route's approval mode (routing-table policy, else APPROVAL_MODE). */
  approvalMode?: "deny" | "admins" | "requester" | "allow";
}

export interface ApprovalDecision {
  allow: boolean;
  message?: string;
  decidedBy?: string;
}

/**
 * Discord-side capabilities handed to the Letta layer for a single turn.
 * Implemented by the Discord layer; consumed by letta/bridge.ts.
 */
export interface TurnContext {
  route: RouteKey;
  triggerMessageId: string;
  requesterId: string;
  /** Called for every normalized event, in order. Must not throw. */
  onEvent: (event: TurnEvent) => void;
  /** Ask a human in Discord to approve a tool call. */
  requestApproval: (req: ApprovalRequest) => Promise<ApprovalDecision>;
}

/**
 * Builds listener-owned client tools (react, history, send_file...) for one
 * route. Called once per pooled session, so tools must read per-turn state via
 * `currentTurn()` rather than capturing a TurnContext. `sandbox` is the
 * conversation's managed-sandbox file client (null on a custom computer).
 */
export type ToolFactory = (
  route: RouteKey,
  currentTurn: () => TurnContext | null,
  sandbox: SandboxFiles | null,
) => AnyAgentTool[];

/** Narrow view of the SDK's managed-sandbox file client. */
export interface SandboxFiles {
  uploadFiles(files: { name: string; data: Blob }[]): Promise<{ files: { path: string; name: string; size: number }[] }>;
  downloadFile(path: string): Promise<Uint8Array>;
}

/** The Letta layer's public surface, consumed by the Discord layer. */
export interface AgentBridge {
  /**
   * Run one turn for a batch of inbound messages on this route. Turns on the
   * same route are serialized by the bridge; messages arriving while a turn is
   * running are queued and merged into the next turn.
   */
  submit(batch: InboundMessage[], ctx: TurnContext): Promise<void>;
  /** Abort this route's in-flight or queued turns, if any. Returns true if anything was cancelled. */
  cancel(route: RouteKey): Promise<boolean>;
  /**
   * Forget the route -> conversation mapping so the next message starts fresh.
   * Routes the routing table pins are left alone and report "pinned".
   */
  reset(route: RouteKey): Promise<"reset" | "pinned">;
  /** Safe, user-visible status (no ids unless admin=true). */
  status(route: RouteKey, admin: boolean): Promise<RouteStatus>;
  /**
   * Where to render what the agent says outside a Discord turn (runs started
   * by its own task notifications). Relay-mode routes only; called once per
   * burst of output, which ends with a `done` event.
   */
  onBackground(sink: BackgroundSink): void;
  shutdown(): Promise<void>;
}

/** Opens a renderer for one burst of agent-initiated output on a route. */
export type BackgroundSink = (route: RouteKey) => (event: TurnEvent) => void;

export interface RouteStatus {
  busy: boolean;
  queued: number;
  hasConversation: boolean;
  pinnedBy?: string; // routing-table rule, e.g. "channel:123" or "fallback"
  conversationId?: string; // admin only
  model?: string; // admin only
  lastActiveAt?: string;
}

export type { SendMessage };
