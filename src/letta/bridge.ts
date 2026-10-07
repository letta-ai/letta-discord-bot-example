import {
  LettaAgentClient,
  type CanUseToolCallback,
  type LettaCodeClientSessionOptions,
  type LettaCodeSession,
  type SDKMessage,
} from "@letta-ai/letta-agent-sdk";
import { randomUUID } from "node:crypto";
import { replyModeFor, type Config, type ReplyMode } from "../config.ts";
import { log } from "../log.ts";
import { resolveRoute, type RoutingTable } from "../routing.ts";
import {
  routeKeyString,
  type AgentBridge,
  type InboundMessage,
  type RouteKey,
  type RouteStatus,
  type SandboxFiles,
  type ToolFactory,
  type TurnContext,
  type TurnEvent,
} from "../types.ts";
import { buildSendMessage, type UploadedAttachment } from "./envelope.ts";
import { RunTracker } from "./run-tracker.ts";
import { RouteStore } from "./store.ts";

/** Minimal client surface used by the bridge (lets tests inject a fake). */
export interface LettaClientLike {
  conversations: {
    create(body: { agentId: string; summary?: string; model?: string }): Promise<{ id: string }>;
  };
  resumeSession(id: string, options?: LettaCodeClientSessionOptions): LettaCodeSession;
  close(): Promise<void>;
}

export interface BridgeDeps {
  client?: LettaClientLike;
  store?: RouteStore;
  toolFactory?: ToolFactory;
  /** Pins Discord surfaces to existing conversations. Null = one conversation per route. */
  routes?: RoutingTable | null;
  /** Override for tests. */
  now?: () => number;
}

interface QueuedTurn {
  batch: InboundMessage[];
  ctx: TurnContext;
}

/**
 * One conversation and the session that drives it. Unpinned routes each get a
 * lane of their own. Routes the routing table pins to the same conversation
 * share a lane, so their turns run one at a time.
 */
interface LaneState {
  key: string;
  /** The route that opened the lane. Turns carry their own route in `current`. */
  route: RouteKey;
  /** Routing-table rule, when the conversation is pinned. A pinned lane never replaces its conversation. */
  pinnedBy: string | null;
  session: LettaCodeSession | null;
  /** Reply mode the session's tools were built for. */
  sessionMode: ReplyMode | null;
  conversationId: string | null;
  model?: string;
  busy: boolean;
  queue: QueuedTurn[];
  current: TurnContext | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastActiveAt?: string;
  aborted: boolean;
  /** The session's runtime reports run ids and loop status, so turns track runs strictly. */
  tracksRuns: boolean;
}

/**
 * Human-readable status for a tool call. Prefers the tool's own `description`
 * argument (Bash, Agent, etc. always carry one), else `Name primary-arg`.
 */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string) : undefined);
  // Paths show as their file name: full paths are long and mostly noise in Discord.
  const file = pick("file_path") ?? pick("path");
  const arg = pick("command") ?? (file ? (file.replace(/\/+$/, "").split("/").pop() || file) : undefined) ?? pick("pattern") ?? pick("query") ?? pick("url");
  const raw = pick("description") ?? (arg ? `${name} ${arg}` : name);
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? `${oneLine.slice(0, 97)}...` : oneLine;
}

/**
 * Stable id for one assistant message, used to split the reply into separate
 * Discord messages. The SDK sets `uuid` to the server message id when present
 * but otherwise generates a new one per chunk, so only trust server ids
 * (`message-...`) and fall back to `otid`; undefined means "same message".
 */
export function assistantMessageId(msg: { uuid?: string; otid?: string | null }): string | undefined {
  if (typeof msg.uuid === "string" && msg.uuid.startsWith("message-")) return msg.uuid;
  return typeof msg.otid === "string" && msg.otid ? `otid:${msg.otid}` : undefined;
}

/**
 * True when the error says the Letta conversation itself is gone. Other
 * "not found" errors (a missing computer, sandbox or agent) must not detach the
 * route from its conversation.
 */
export function isConversationMissing(err: unknown, conversationId: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (!/not found|\b404\b/i.test(message)) return false;
  return /conversation/i.test(message) || message.includes(conversationId);
}

/** Options for the SDK's cloud client. */
export function clientOptions(config: Config) {
  return {
    backend: "cloud" as const,
    apiKey: config.LETTA_API_KEY,
    ...(config.LETTA_BASE_URL ? { apiBaseUrl: config.LETTA_BASE_URL } : {}),
    // The SDK fails any turn still running after this long (default 2 min), and
    // the clock keeps running while a Discord approval is pending.
    requestTimeoutMs: config.TURN_TIMEOUT_SECONDS * 1000,
    // A named computer and managed-sandbox options are mutually exclusive in the SDK.
    ...(config.LETTA_COMPUTER
      ? { computer: config.LETTA_COMPUTER }
      : { sandbox: { ttlMinutes: Math.min(60, Math.max(1, config.SANDBOX_TTL_MINUTES)) } }),
  };
}

export function createAgentBridge(config: Config, deps: BridgeDeps = {}): AgentBridge {
  const client: LettaClientLike =
    deps.client ?? (new LettaAgentClient(clientOptions(config)) as unknown as LettaClientLike);
  const store = deps.store ?? new RouteStore(config.DATA_DIR);
  const lanes = new Map<string, LaneState>();
  let shuttingDown = false;

  function laneKey(route: RouteKey): { key: string; target: ReturnType<typeof resolveRoute> } {
    const target = resolveRoute(deps.routes, route);
    return { key: target.kind === "pinned" ? `pin:${target.conversationId}` : routeKeyString(route), target };
  }

  function existingLane(route: RouteKey): LaneState | undefined {
    return lanes.get(laneKey(route).key);
  }

  function lane(route: RouteKey): LaneState {
    const { key, target } = laneKey(route);
    let s = lanes.get(key);
    if (!s) {
      const pinned = target.kind === "pinned";
      s = {
        key,
        route,
        pinnedBy: pinned ? target.rule : null,
        session: null,
        sessionMode: null,
        conversationId: pinned ? target.conversationId : (store.get(key)?.conversationId ?? null),
        busy: false,
        queue: [],
        current: null,
        idleTimer: null,
        aborted: false,
        tracksRuns: false,
      };
      lanes.set(key, s);
    }
    return s;
  }

  const sameRoute = (a: RouteKey, b: RouteKey) => routeKeyString(a) === routeKeyString(b);

  /** Drop queued turns (only `route`'s, when given), telling each one it was interrupted so its renderer settles. */
  function dropQueue(s: LaneState, route?: RouteKey): number {
    const dropped = route ? s.queue.filter((it) => sameRoute(it.ctx.route, route)) : s.queue.splice(0, s.queue.length);
    if (route) s.queue = s.queue.filter((it) => !sameRoute(it.ctx.route, route));
    for (const it of dropped) {
      try {
        it.ctx.onEvent({ kind: "done", success: false, errorCode: "interrupted", durationMs: 0 });
      } catch {}
    }
    return dropped.length;
  }

  function closeSession(s: LaneState, reason: string) {
    if (s.idleTimer) clearTimeout(s.idleTimer);
    s.idleTimer = null;
    s.sessionMode = null;
    s.tracksRuns = false;
    if (s.session) {
      log.debug("closing session", { route: s.key, reason });
      try {
        s.session.close();
      } catch (err) {
        log.warn("session close failed", { route: s.key, err: String(err) });
      }
      s.session = null;
    }
  }

  function armIdle(s: LaneState) {
    if (s.idleTimer) clearTimeout(s.idleTimer);
    const ms = config.SESSION_IDLE_MINUTES * 60_000;
    if (ms <= 0) return;
    s.idleTimer = setTimeout(() => {
      if (!s.busy) closeSession(s, "idle");
    }, ms);
    s.idleTimer.unref?.();
  }

  async function ensureConversation(s: LaneState, ctx: TurnContext): Promise<boolean> {
    if (s.conversationId || s.pinnedBy) return false;
    const conv = await client.conversations.create({
      agentId: config.LETTA_AGENT_ID,
      summary: `discord:${s.key}`,
      ...(config.CONVERSATION_MODEL ? { model: config.CONVERSATION_MODEL } : {}),
    });
    s.conversationId = conv.id;
    store.set(s.key, conv.id);
    log.info("created conversation", { route: s.key, conversationId: conv.id, trigger: ctx.triggerMessageId });
    return true;
  }

  function canUseTool(s: LaneState): CanUseToolCallback {
    return async (toolName, toolInput, context) => {
      const turn = s.current;
      // Speaking in a tool-mode channel must never wait on an approver. The tool
      // only posts into this route, with mentions disabled.
      if (config.APPROVAL_MODE === "allow" || toolName === "discord_send_message") return { behavior: "allow" };
      if (config.APPROVAL_MODE === "deny" || !turn) {
        return { behavior: "deny", message: `Tool ${toolName} requires approval, which is disabled for this Discord bot.` };
      }
      try {
        const decision = await turn.requestApproval({
          route: turn.route,
          requesterId: turn.requesterId,
          toolName,
          toolInput,
          toolCallId: context?.toolCallId,
        });
        return decision.allow
          ? { behavior: "allow", ...(decision.message ? { message: decision.message } : {}) }
          : { behavior: "deny", message: decision.message ?? `A Discord approver denied ${toolName}.` };
      } catch (err) {
        log.warn("approval failed", { route: s.key, err: String(err) });
        return { behavior: "deny", message: "Approval could not be collected." };
      }
    };
  }

  async function ensureSession(s: LaneState, route: RouteKey, mode: ReplyMode): Promise<LettaCodeSession> {
    // A pinned lane can serve routes with different reply modes, and the tool
    // set is fixed per session, so switch sessions when the mode changes.
    if (s.session && s.sessionMode !== mode) closeSession(s, "reply mode changed");
    if (s.session) return s.session;
    const conversationId = s.conversationId!;
    // Sandbox file client is only known after the session exists, so tools
    // resolve it lazily through this holder.
    let sandboxRef: SandboxFiles | null = null;
    const sandboxProxy: SandboxFiles = {
      uploadFiles: (files) => {
        if (!sandboxRef) throw new Error("No managed sandbox for this conversation.");
        return sandboxRef.uploadFiles(files);
      },
      downloadFile: (path) => {
        if (!sandboxRef) throw new Error("No managed sandbox for this conversation.");
        return sandboxRef.downloadFile(path);
      },
    };
    const tools =
      deps.toolFactory
        ? deps.toolFactory(route, () => s.current, config.LETTA_COMPUTER ? null : sandboxProxy)
        : [];
    const allowedTools =
      config.ALLOWED_TOOLS.length > 0 ? [...new Set([...config.ALLOWED_TOOLS, ...tools.map((t) => t.name)])] : undefined;
    const options: LettaCodeClientSessionOptions = {
      permissionMode: config.PERMISSION_MODE,
      canUseTool: canUseTool(s),
      ...(tools.length ? { tools } : {}),
      ...(allowedTools ? { allowedTools } : {}),
      ...(config.TOOLSET_BASE ? { toolset: { base: config.TOOLSET_BASE } } : {}),
    };
    // The SDK resumes an agent's default conversation when given the agent id.
    const session = client.resumeSession(conversationId === "default" ? config.LETTA_AGENT_ID : conversationId, options);
    const info = await session.ready().catch((err: unknown) => {
      // Never pooled in s.session, so nothing else would close it.
      try {
        session.close();
      } catch {}
      throw err;
    });
    sandboxRef = (session.sandbox as SandboxFiles | undefined) ?? null;
    s.model = info.model;
    s.session = session;
    s.sessionMode = mode;
    log.info("session ready", { route: s.key, conversationId, model: info.model, sandbox: !!sandboxRef, mode });
    return session;
  }

  async function uploadFiles(
    s: LaneState,
    session: LettaCodeSession,
    batch: InboundMessage[],
    emit: (e: TurnEvent) => void,
  ): Promise<UploadedAttachment[]> {
    const out: UploadedAttachment[] = [];
    const sandbox = session.sandbox as SandboxFiles | undefined;
    for (const m of batch) {
      for (const f of m.files) {
        const base: UploadedAttachment = {
          messageId: m.messageId,
          name: f.name,
          url: f.url,
          contentType: f.contentType,
          size: f.size,
          ...(f.voice ? { voice: true } : {}),
          ...(f.durationSecs !== undefined ? { durationSecs: f.durationSecs } : {}),
          ...(f.transcript !== undefined ? { transcript: f.transcript } : {}),
          ...(f.transcriptProvider ? { transcriptProvider: f.transcriptProvider } : {}),
          ...(f.transcriptModel ? { transcriptModel: f.transcriptModel } : {}),
          ...(f.transcriptError ? { transcriptError: f.transcriptError } : {}),
        };
        const safeName = `${m.messageId}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
        if (!sandbox && f.data && config.LOCAL_ATTACHMENT_DIR) {
          try {
            const { mkdir, writeFile } = await import("node:fs/promises");
            const { join, resolve } = await import("node:path");
            const dir = resolve(config.LOCAL_ATTACHMENT_DIR);
            await mkdir(dir, { recursive: true });
            const dest = join(dir, safeName);
            await writeFile(dest, new Uint8Array(await f.data.arrayBuffer()));
            base.path = dest;
          } catch (err) {
            log.warn("local attachment save failed; falling back to url", { route: s.key, file: f.name, err: String(err) });
          }
        } else if (sandbox && f.data) {
          try {
            const res = await sandbox.uploadFiles([{ name: safeName, data: f.data }]);
            const uploaded = res.files[0];
            if (uploaded) base.path = uploaded.path;
          } catch (err) {
            log.warn("sandbox upload failed; falling back to url", { route: s.key, file: f.name, err: String(err) });
          }
        }
        out.push(base);
      }
    }
    const paths = out.map((a) => a.path).filter((p): p is string => !!p);
    if (paths.length) emit({ kind: "files_uploaded", paths });
    return out;
  }

  /**
   * Map one SDK message to zero or more normalized events. Returns true on terminal result.
   * `acted` is set once the agent has produced text or touched a tool, after
   * which the turn must not be resent.
   */
  function mapMessage(msg: SDKMessage, emit: (e: TurnEvent) => void, acted: { v: boolean }): boolean {
    switch (msg.type) {
      case "assistant":
        if (msg.content) {
          acted.v = true;
          emit({ kind: "assistant_delta", text: msg.content, messageId: assistantMessageId(msg) });
        }
        return false;
      case "reasoning":
        if (msg.content) emit({ kind: "reasoning_delta", text: msg.content });
        return false;
      case "tool_call":
        acted.v = true;
        emit({
          kind: "tool_call",
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          summary: toolLabel(msg.toolName, msg.toolInput ?? {}),
        });
        return false;
      case "tool_result":
        acted.v = true;
        emit({ kind: "tool_result", toolCallId: msg.toolCallId, isError: msg.isError });
        return false;
      case "retry":
        emit({ kind: "retry", attempt: msg.attempt, maxAttempts: msg.maxAttempts });
        return false;
      case "error":
        log.warn("turn error event", { stopReason: msg.stopReason, code: msg.errorCode, detail: msg.message });
        return false;
      case "result":
        emit({
          kind: "done",
          success: msg.success,
          ...(msg.errorCode || msg.error ? { errorCode: msg.errorCode ?? msg.error } : {}),
          durationMs: msg.durationMs,
        });
        return true;
      default:
        return false;
    }
  }

  async function runTurn(s: LaneState, batch: InboundMessage[], ctx: TurnContext): Promise<void> {
    const emit = (e: TurnEvent) => {
      try {
        ctx.onEvent(e);
      } catch (err) {
        log.warn("onEvent threw", { err: String(err) });
      }
    };
    s.current = ctx;
    s.aborted = false;
    const acted = { v: false };
    /** /cancel or /new arrived while the turn was still setting up: stop before anything is sent. */
    const interruptedDuringSetup = () => {
      if (!s.aborted) return false;
      // /new also cleared the conversation, so a session bound to the old one must not be reused.
      if (!s.conversationId) closeSession(s, "reset");
      emit({ kind: "done", success: false, errorCode: "interrupted", durationMs: 0 });
      return true;
    };
    // Signal the turn immediately so Discord shows typing while the
    // conversation and sandbox spin up (session start can take 10s+).
    emit({ kind: "started", conversationId: s.conversationId ?? "", createdConversation: !s.conversationId });
    const mode = replyModeFor(config, ctx.route);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await ensureConversation(s, ctx);
        const session = await ensureSession(s, ctx.route, mode);
        if (interruptedDuringSetup()) return;
        const attachments = await uploadFiles(s, session, batch, emit);
        if (interruptedDuringSetup()) return;
        // Tag our message so its runs can be told apart from task-notification
        // turns and background subagents streaming into the same conversation.
        const tracker = new RunTracker(`discord-${randomUUID()}`, s.tracksRuns);
        const started = Date.now();
        await session.send(buildSendMessage(batch, attachments, mode), { otid: tracker.otid });
        let terminal = false;
        // Once a foreign result has taken the SDK's turn, the SDK's own
        // timeout no longer covers ours, so bound the wait here.
        let deadline: ReturnType<typeof setTimeout> | null = null;
        let timedOut = false;
        reading: for (;;) {
          // The SDK ends each stream() at a result; after skipping a foreign
          // result, read on for our own run.
          let skipped = false;
          for await (const msg of session.stream()) {
            const verdict = tracker.see(msg);
            // Output held until its run was identified goes out first, in order.
            for (const held of tracker.release()) mapMessage(held, emit, acted);
            if (verdict === "drop" || verdict === "hold") continue;
            if (verdict === "skip-result") {
              log.info("ignored result from another run", { route: s.key, runIds: (msg as { runIds?: string[] }).runIds });
              skipped = true;
              deadline ??= setTimeout(() => {
                timedOut = true;
                // Abort alone may emit nothing when the SDK has no turn open;
                // closing resolves the pending read so the lane is freed.
                session.abort().catch(() => {}).finally(() => closeSession(s, "turn timeout"));
              }, config.TURN_TIMEOUT_SECONDS * 1000);
              continue;
            }
            if (verdict === "end") {
              emit({ kind: "done", success: true, durationMs: Date.now() - started });
              terminal = true;
              break reading;
            }
            if (mapMessage(msg, emit, acted)) {
              terminal = true;
              break reading;
            }
          }
          if (!skipped || s.aborted || timedOut) break;
        }
        if (deadline) clearTimeout(deadline);
        if (tracker.tracksRuns && s.session === session) s.tracksRuns = true;
        if (tracker.foreign.size || tracker.unclaimed().length) {
          log.debug("dropped foreign runs", { route: s.key, runs: [...tracker.foreign, ...tracker.unclaimed()] });
        }
        if (!terminal && timedOut) {
          emit({ kind: "error", message: "The agent did not finish this turn in time." });
          emit({ kind: "done", success: false, errorCode: "timeout", durationMs: Date.now() - started });
          return;
        }
        if (!terminal) {
          if (s.aborted) {
            emit({ kind: "done", success: false, errorCode: "interrupted", durationMs: 0 });
            return;
          }
          throw new Error("stream ended without a result");
        }
        if (s.pinnedBy) store.touchPinned(routeKeyString(ctx.route));
        else store.touch(s.key);
        s.lastActiveAt = new Date().toISOString();
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("turn failed", { route: s.key, attempt, err: message });
        closeSession(s, "error");
        if (s.pinnedBy && s.conversationId && isConversationMissing(err, s.conversationId)) {
          // Never replace a pinned conversation: that would silently fork the
          // operator's history. Fail loudly and leave the table to be fixed.
          log.error("pinned conversation not found; fix ROUTES_FILE", {
            conversationId: s.conversationId,
            rule: s.pinnedBy,
          });
          emit({ kind: "error", message: `Pinned conversation ${s.conversationId} (${s.pinnedBy}) was not found.` });
          emit({ kind: "done", success: false, errorCode: "error", durationMs: 0 });
          return;
        }
        if (s.conversationId && isConversationMissing(err, s.conversationId)) {
          // Conversation was deleted on the Letta side; start fresh next attempt.
          store.delete(s.key);
          s.conversationId = null;
        }
        if (attempt === 2 || acted.v || s.aborted || shuttingDown) {
          emit({ kind: "error", message });
          emit({ kind: "done", success: false, errorCode: s.aborted ? "interrupted" : "error", durationMs: 0 });
          return;
        }
      }
    }
  }

  async function drain(s: LaneState) {
    if (s.busy) return;
    s.busy = true;
    try {
      while (s.queue.length > 0 && !shuttingDown) {
        // Merge the queued run from the same route into one turn; the newest
        // context renders the reply. A shared lane never merges across routes.
        const first = s.queue[0]!.ctx.route;
        let n = 1;
        while (n < s.queue.length && sameRoute(s.queue[n]!.ctx.route, first)) n++;
        const items = s.queue.splice(0, n);
        const last = items[items.length - 1]!;
        for (const it of items.slice(0, -1)) {
          try {
            it.ctx.onEvent({ kind: "merged", intoMessageId: last.ctx.triggerMessageId });
          } catch {}
        }
        await runTurn(
          s,
          items.flatMap((i) => i.batch),
          last.ctx,
        );
        s.current = null;
      }
    } finally {
      s.busy = false;
      armIdle(s);
    }
  }

  return {
    async submit(batch, ctx) {
      if (shuttingDown || batch.length === 0) return;
      const s = lane(ctx.route);
      s.queue.push({ batch, ctx });
      await drain(s);
    },

    async cancel(route) {
      const s = existingLane(route);
      if (!s) return false;
      const hadQueue = dropQueue(s, route) > 0;
      // In a shared lane, only cancel the running turn if it belongs to this route.
      if (!s.busy || !s.current || !sameRoute(s.current.route, route)) return hadQueue;
      s.aborted = true;
      // Still creating the conversation or sandbox: runTurn stops before sending.
      if (!s.session) return true;
      try {
        await s.session.abort();
      } catch (err) {
        log.warn("abort failed", { route: s.key, err: String(err) });
      }
      return true;
    },

    async reset(route) {
      if (resolveRoute(deps.routes, route).kind === "pinned") return "pinned";
      const key = routeKeyString(route);
      const s = lanes.get(key);
      if (s) {
        dropQueue(s);
        if (s.busy) {
          s.aborted = true;
          if (s.session) await s.session.abort().catch(() => {});
        }
        closeSession(s, "reset");
        s.conversationId = null;
      }
      store.delete(key);
      return "reset";
    },

    async status(route, admin): Promise<RouteStatus> {
      const key = routeKeyString(route);
      const target = resolveRoute(deps.routes, route);
      const s = existingLane(route);
      const pinned = target.kind === "pinned";
      const rec = pinned ? null : store.get(key);
      const lastActiveAt = s?.lastActiveAt ?? (pinned ? store.pinnedLastActive(key) : rec?.lastActiveAt);
      return {
        busy: !!s?.busy,
        queued: s?.queue.filter((it) => sameRoute(it.ctx.route, route)).length ?? 0,
        hasConversation: pinned || !!(s?.conversationId ?? rec?.conversationId),
        ...(pinned ? { pinnedBy: target.rule } : {}),
        ...(lastActiveAt ? { lastActiveAt } : {}),
        ...(admin
          ? {
              conversationId: pinned ? target.conversationId : (s?.conversationId ?? rec?.conversationId),
              model: s?.model,
            }
          : {}),
      };
    },

    async shutdown() {
      shuttingDown = true;
      await Promise.all(
        [...lanes.values()].map(async (s) => {
          dropQueue(s);
          if (s.busy && s.session) await s.session.abort().catch(() => {});
          closeSession(s, "shutdown");
        }),
      );
      await client.close().catch(() => {});
      store.close();
    },
  };
}

/** Exposed for /healthz. */
export function routeCount(store: RouteStore): number {
  return store.count();
}
