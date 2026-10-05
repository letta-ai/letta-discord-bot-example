import {
  LettaAgentClient,
  type CanUseToolCallback,
  type LettaCodeClientSessionOptions,
  type LettaCodeSession,
  type SDKMessage,
} from "@letta-ai/letta-agent-sdk";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
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
  /** Override for tests. */
  now?: () => number;
}

interface QueuedTurn {
  batch: InboundMessage[];
  ctx: TurnContext;
}

interface RouteState {
  key: string;
  route: RouteKey;
  session: LettaCodeSession | null;
  conversationId: string | null;
  model?: string;
  busy: boolean;
  queue: QueuedTurn[];
  current: TurnContext | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastActiveAt?: string;
  aborted: boolean;
}

/**
 * Human-readable status for a tool call. Prefers the tool's own `description`
 * argument (Bash, Agent, etc. always carry one), else `Name primary-arg`.
 */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string) : undefined);
  const arg = pick("command") ?? pick("file_path") ?? pick("path") ?? pick("pattern") ?? pick("query") ?? pick("url");
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

export function createAgentBridge(config: Config, deps: BridgeDeps = {}): AgentBridge {
  const client: LettaClientLike =
    deps.client ??
    (new LettaAgentClient({
      backend: "cloud",
      apiKey: config.LETTA_API_KEY,
      ...(config.LETTA_BASE_URL ? { apiBaseUrl: config.LETTA_BASE_URL } : {}),
      // A named computer and managed-sandbox options are mutually exclusive in the SDK.
      ...(config.LETTA_COMPUTER
        ? { computer: config.LETTA_COMPUTER }
        : { sandbox: { ttlMinutes: Math.min(60, Math.max(1, config.SANDBOX_TTL_MINUTES)) } }),
    }) as unknown as LettaClientLike);
  const store = deps.store ?? new RouteStore(config.DATA_DIR);
  const routes = new Map<string, RouteState>();
  let shuttingDown = false;

  function state(route: RouteKey): RouteState {
    const key = routeKeyString(route);
    let s = routes.get(key);
    if (!s) {
      s = {
        key,
        route,
        session: null,
        conversationId: store.get(key)?.conversationId ?? null,
        busy: false,
        queue: [],
        current: null,
        idleTimer: null,
        aborted: false,
      };
      routes.set(key, s);
    }
    return s;
  }

  /** Drop queued turns, telling each one it was interrupted so its renderer settles. */
  function dropQueue(s: RouteState): number {
    const dropped = s.queue.splice(0, s.queue.length);
    for (const it of dropped) {
      try {
        it.ctx.onEvent({ kind: "done", success: false, errorCode: "interrupted", durationMs: 0 });
      } catch {}
    }
    return dropped.length;
  }

  function closeSession(s: RouteState, reason: string) {
    if (s.idleTimer) clearTimeout(s.idleTimer);
    s.idleTimer = null;
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

  function armIdle(s: RouteState) {
    if (s.idleTimer) clearTimeout(s.idleTimer);
    const ms = config.SESSION_IDLE_MINUTES * 60_000;
    if (ms <= 0) return;
    s.idleTimer = setTimeout(() => {
      if (!s.busy) closeSession(s, "idle");
    }, ms);
    s.idleTimer.unref?.();
  }

  async function ensureConversation(s: RouteState, ctx: TurnContext): Promise<boolean> {
    if (s.conversationId) return false;
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

  function canUseTool(s: RouteState): CanUseToolCallback {
    return async (toolName, toolInput, context) => {
      const turn = s.current;
      if (config.APPROVAL_MODE === "allow") return { behavior: "allow" };
      if (config.APPROVAL_MODE === "deny" || !turn) {
        return { behavior: "deny", message: `Tool ${toolName} requires approval, which is disabled for this Discord bot.` };
      }
      try {
        const decision = await turn.requestApproval({
          route: s.route,
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

  async function ensureSession(s: RouteState): Promise<LettaCodeSession> {
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
      config.ENABLE_DISCORD_TOOLS && deps.toolFactory
        ? deps.toolFactory(s.route, () => s.current, config.LETTA_COMPUTER ? null : sandboxProxy)
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
    const session = client.resumeSession(conversationId, options);
    const info = await session.ready();
    sandboxRef = (session.sandbox as SandboxFiles | undefined) ?? null;
    s.model = info.model;
    s.session = session;
    log.info("session ready", { route: s.key, conversationId, model: info.model, sandbox: !!sandboxRef });
    return session;
  }

  async function uploadFiles(
    s: RouteState,
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

  /** Map one SDK message to zero or more normalized events. Returns true on terminal result. */
  function mapMessage(msg: SDKMessage, emit: (e: TurnEvent) => void, seenText: { v: boolean }): boolean {
    switch (msg.type) {
      case "assistant":
        if (msg.content) {
          seenText.v = true;
          emit({ kind: "assistant_delta", text: msg.content, messageId: assistantMessageId(msg) });
        }
        return false;
      case "reasoning":
        if (msg.content) emit({ kind: "reasoning_delta", text: msg.content });
        return false;
      case "tool_call":
        emit({
          kind: "tool_call",
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          summary: toolLabel(msg.toolName, msg.toolInput ?? {}),
        });
        return false;
      case "tool_result":
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

  async function runTurn(s: RouteState, batch: InboundMessage[], ctx: TurnContext): Promise<void> {
    const emit = (e: TurnEvent) => {
      try {
        ctx.onEvent(e);
      } catch (err) {
        log.warn("onEvent threw", { err: String(err) });
      }
    };
    s.current = ctx;
    s.aborted = false;
    const seenText = { v: false };
    // Signal the turn immediately so Discord shows typing while the
    // conversation and sandbox spin up (session start can take 10s+).
    emit({ kind: "started", conversationId: s.conversationId ?? "", createdConversation: !s.conversationId });
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await ensureConversation(s, ctx);
        const session = await ensureSession(s);
        const attachments = await uploadFiles(s, session, batch, emit);
        await session.send(buildSendMessage(batch, attachments));
        let terminal = false;
        for await (const msg of session.stream()) {
          if (mapMessage(msg, emit, seenText)) {
            terminal = true;
            break;
          }
        }
        if (!terminal) {
          if (s.aborted) {
            emit({ kind: "done", success: false, errorCode: "interrupted", durationMs: 0 });
            return;
          }
          throw new Error("stream ended without a result");
        }
        store.touch(s.key);
        s.lastActiveAt = new Date().toISOString();
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("turn failed", { route: s.key, attempt, err: message });
        closeSession(s, "error");
        if (/not found|404/i.test(message) && s.conversationId) {
          // Conversation was deleted on the Letta side; start fresh next attempt.
          store.delete(s.key);
          s.conversationId = null;
        }
        if (attempt === 2 || seenText.v || s.aborted || shuttingDown) {
          emit({ kind: "error", message });
          emit({ kind: "done", success: false, errorCode: s.aborted ? "interrupted" : "error", durationMs: 0 });
          return;
        }
      }
    }
  }

  async function drain(s: RouteState) {
    if (s.busy) return;
    s.busy = true;
    try {
      while (s.queue.length > 0 && !shuttingDown) {
        // Merge everything queued so far into one turn; the newest context renders the reply.
        const items = s.queue.splice(0, s.queue.length);
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
      const s = state(ctx.route);
      s.queue.push({ batch, ctx });
      await drain(s);
    },

    async cancel(route) {
      const s = routes.get(routeKeyString(route));
      if (!s) return false;
      const hadQueue = dropQueue(s) > 0;
      if (!s.busy || !s.session) return hadQueue;
      s.aborted = true;
      try {
        await s.session.abort();
      } catch (err) {
        log.warn("abort failed", { route: s.key, err: String(err) });
      }
      return true;
    },

    async reset(route) {
      const key = routeKeyString(route);
      const s = routes.get(key);
      if (s) {
        dropQueue(s);
        if (s.busy && s.session) {
          s.aborted = true;
          await s.session.abort().catch(() => {});
        }
        closeSession(s, "reset");
        s.conversationId = null;
      }
      store.delete(key);
    },

    async status(route, admin): Promise<RouteStatus> {
      const key = routeKeyString(route);
      const s = routes.get(key);
      const rec = store.get(key);
      return {
        busy: !!s?.busy,
        queued: s?.queue.length ?? 0,
        hasConversation: !!(s?.conversationId ?? rec?.conversationId),
        ...(s?.lastActiveAt || rec?.lastActiveAt ? { lastActiveAt: s?.lastActiveAt ?? rec?.lastActiveAt } : {}),
        ...(admin
          ? {
              conversationId: s?.conversationId ?? rec?.conversationId,
              model: s?.model,
            }
          : {}),
      };
    },

    async shutdown() {
      shuttingDown = true;
      await Promise.all(
        [...routes.values()].map(async (s) => {
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
