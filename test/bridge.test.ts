import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@letta-ai/letta-agent-sdk";
import { loadConfig } from "../src/config.ts";
import { parseRoutingTable } from "../src/routing.ts";
import { TOOL_MODE_PREAMBLE, UNTRUSTED_PREAMBLE } from "../src/letta/envelope.ts";
import { clientOptions, createAgentBridge, type LettaClientLike } from "../src/letta/bridge.ts";
import { RouteStore } from "../src/letta/store.ts";
import type { InboundMessage, RouteKey, TurnContext, TurnEvent } from "../src/types.ts";

const config = loadConfig({
  DISCORD_BOT_TOKEN: "x",
  LETTA_API_KEY: "y",
  LETTA_AGENT_ID: "agent-123",
  SESSION_IDLE_MINUTES: "0",
  APPROVAL_MODE: "admins",
});

const route: RouteKey = { guildId: "g", channelId: "c", threadId: "t" };

function inbound(id: string, text: string, files: InboundMessage["files"] = [], r: RouteKey = route): InboundMessage {
  return {
    route: r,
    messageId: id,
    authorId: "u1",
    authorName: "Ann",
    authorIsBot: false,
    text,
    createdAt: "2026-10-05T00:00:00.000Z",
    images: [],
    files,
  };
}

type Script = (sent: unknown, n: number, otid?: string) => SDKMessage[] | Error;

function fakeClient(script: Script, opts: { failReadyOnce?: boolean; noSandbox?: boolean; readyGate?: Promise<void> } = {}) {
  const calls = { creates: 0, resumes: 0, sends: [] as unknown[], closes: 0, aborts: 0, uploads: [] as string[], canUseTool: null as any, resumedIds: [] as string[] };
  let readyFails = opts.failReadyOnce ? 1 : 0;
  const client: LettaClientLike = {
    conversations: {
      async create() {
        calls.creates++;
        return { id: `conv-${calls.creates}` };
      },
    },
    resumeSession(_id, options) {
      calls.resumes++;
      calls.resumedIds.push(_id);
      calls.canUseTool = options?.canUseTool;
      let queue: SDKMessage[] = [];
      let release: (() => void) | null = null;
      const session = {
        sandbox: opts.noSandbox ? undefined : {
          async uploadFiles(files: { name: string }[]) {
            calls.uploads.push(...files.map((f) => f.name));
            return { files: files.map((f) => ({ path: `/root/downloads/${f.name}`, name: f.name, mimeType: "x", size: 1 })) };
          },
          async downloadFile() {
            return new Uint8Array();
          },
        },
        async ready() {
          if (opts.readyGate) await opts.readyGate;
          if (readyFails > 0) {
            readyFails--;
            throw new Error("socket closed");
          }
          return { model: "test/model" };
        },
        async send(m: unknown, o?: { otid?: string }) {
          calls.sends.push(m);
          const r = script(m, calls.sends.length, o?.otid);
          if (r instanceof Error) throw r;
          queue = r;
        },
        async *stream() {
          while (queue.length) {
            const next = queue.shift()!;
            // simulate the stream dying mid-turn
            if ((next as { type: string }).type === "throw") throw new Error("stream died");
            yield next;
            if (next.type === "result") return;
          }
          // simulate an abort that ends the stream without a result
          await new Promise<void>((res) => (release = res));
        },
        async abort() {
          calls.aborts++;
          release?.();
        },
        close() {
          calls.closes++;
        },
      };
      return session as never;
    },
    async close() {},
  };
  return { client, calls };
}

function ctxCollector(id = "m1", r: RouteKey = route): { ctx: TurnContext; events: TurnEvent[] } {
  const events: TurnEvent[] = [];
  return {
    events,
    ctx: {
      route: r,
      triggerMessageId: id,
      requesterId: "u1",
      onEvent: (e) => events.push(e),
      requestApproval: async () => ({ allow: true, decidedBy: "admin" }),
    },
  };
}

const ok = (text: string): SDKMessage[] =>
  [
    { type: "assistant", content: text } as SDKMessage,
    { type: "result", success: true, durationMs: 5 } as SDKMessage,
  ];

describe("bridge", () => {
  test("creates a conversation once per route and streams events", async () => {
    const store = new RouteStore(":memory:");
    const { client, calls } = fakeClient(() => ok("hi"));
    const bridge = createAgentBridge(config, { client, store });
    const a = ctxCollector("m1");
    await bridge.submit([inbound("m1", "hello")], a.ctx);
    const b = ctxCollector("m2");
    await bridge.submit([inbound("m2", "again")], b.ctx);

    expect(calls.creates).toBe(1);
    expect(calls.resumes).toBe(1); // session reused
    expect(a.events.map((e) => e.kind)).toEqual(["started", "assistant_delta", "done"]);
    expect(a.events[0]).toMatchObject({ kind: "started", createdConversation: true });
    expect(b.events[0]).toMatchObject({ kind: "started", createdConversation: false });
    expect(store.get("g:c:t")?.conversationId).toBe("conv-1");
    expect(String(calls.sends[0])).toContain("<channel-notification");
  });

  test("open channels in tool mode tell the agent to speak through the tool and never gate it", async () => {
    const toolConfig = loadConfig({
      DISCORD_BOT_TOKEN: "x",
      LETTA_API_KEY: "y",
      LETTA_AGENT_ID: "agent-123",
      SESSION_IDLE_MINUTES: "0",
      APPROVAL_MODE: "deny",
      DISCORD_OPEN_CHANNEL_IDS: "c",
      OPEN_CHANNEL_REPLY_MODE: "tool",
    });
    const { client, calls } = fakeClient(() => ok("ignored"));
    const bridge = createAgentBridge(toolConfig, { client, store: new RouteStore(":memory:") });
    await bridge.submit([inbound("m1", "anyone around?")], ctxCollector("m1").ctx);

    expect(String(calls.sends[0])).toContain(TOOL_MODE_PREAMBLE);
    expect(String(calls.sends[0])).not.toContain(UNTRUSTED_PREAMBLE);
    expect(await calls.canUseTool("discord_send_message", { content: "hi" }, {})).toEqual({ behavior: "allow" });
    expect(await calls.canUseTool("Bash", { command: "ls" }, {})).toMatchObject({ behavior: "deny" });
  });

  test("relay routes keep the automatic-reply preamble", async () => {
    const { client, calls } = fakeClient(() => ok("hi"));
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    await bridge.submit([inbound("m1", "hello")], ctxCollector("m1").ctx);
    expect(String(calls.sends[0])).toContain(UNTRUSTED_PREAMBLE);
  });

  test("uploads files into the sandbox and references paths in the envelope", async () => {
    const { client, calls } = fakeClient(() => ok("got it"));
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    const file = { name: "data.csv", url: "https://cdn/x", contentType: "text/csv", size: 3, data: new Blob(["a,b"]) };
    await bridge.submit([inbound("m1", "see file", [file])], c.ctx);
    expect(calls.uploads).toEqual(["m1-data.csv"]);
    expect(String(calls.sends[0])).not.toContain("<transcript>");
    expect(String(calls.sends[0])).toContain('path="/root/downloads/m1-data.csv"');
    expect(c.events.some((e) => e.kind === "files_uploaded")).toBe(true);
  });

  test("without a managed sandbox, writes files to LOCAL_ATTACHMENT_DIR and references local paths", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "ldl-att-"));
    const localConfig = loadConfig({
      DISCORD_BOT_TOKEN: "x",
      LETTA_API_KEY: "y",
      LETTA_AGENT_ID: "agent-123",
      SESSION_IDLE_MINUTES: "0",
      LOCAL_ATTACHMENT_DIR: dir,
    });
    const { client, calls } = fakeClient(() => ok("got it"), { noSandbox: true });
    const bridge = createAgentBridge(localConfig, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    const file = { name: "Luna clip.mp4", url: "https://cdn/x.mp4", contentType: "video/mp4", size: 3, data: new Blob(["abc"]) };
    await bridge.submit([inbound("m1", "see video", [file])], c.ctx);
    const expected = join(dir, "m1-Luna_clip.mp4");
    expect(readFileSync(expected, "utf8")).toBe("abc");
    expect(String(calls.sends[0])).toContain(`path="${expected}"`);
    expect(String(calls.sends[0])).toContain(`url="https://cdn/x.mp4"`);
    expect(c.events.some((e) => e.kind === "files_uploaded")).toBe(true);
  });

  test("passes voice transcripts through to the envelope", async () => {
    const { client, calls } = fakeClient(() => ok("heard you"));
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const file = { name: "voice-message.ogg", url: "https://cdn/v", contentType: "audio/ogg", size: 3, data: new Blob(["ogg"]), voice: true, durationSecs: 2, transcript: "deploy the thing", transcriptProvider: "groq", transcriptModel: "whisper-large-v3-turbo" };
    await bridge.submit([inbound("m1", "", [file])], ctxCollector().ctx);
    expect(String(calls.sends[0])).toContain('voice="true"');
    expect(String(calls.sends[0])).toContain('<transcript auto="true" provider="groq" model="whisper-large-v3-turbo">deploy the thing</transcript>');
  });

  test("retries once after a session failure before any text", async () => {
    const { client, calls } = fakeClient(() => ok("recovered"), { failReadyOnce: true });
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    await bridge.submit([inbound("m1", "hi")], c.ctx);
    expect(calls.resumes).toBe(2);
    // The session whose ready() failed was never pooled, so it must be closed here.
    expect(calls.closes).toBe(1);
    expect(c.events.at(-1)).toMatchObject({ kind: "done", success: true });
  });

  test("does not resend the message after a tool call already ran", async () => {
    const { client, calls } = fakeClient(() => [
      { type: "tool_call", toolCallId: "t1", toolName: "Bash", toolInput: { command: "deploy" } } as unknown as SDKMessage,
      { type: "throw" } as unknown as SDKMessage,
    ]);
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    await bridge.submit([inbound("m1", "deploy it")], c.ctx);
    expect(calls.sends).toHaveLength(1);
    expect(c.events.at(-1)).toMatchObject({ kind: "done", success: false, errorCode: "error" });
  });

  test("an unrelated 'not found' error keeps the route's conversation", async () => {
    const { client, calls } = fakeClient(() => new Error("Computer not found: build-box"));
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    await bridge.submit([inbound("m1", "hi")], c.ctx);
    expect(c.events.at(-1)).toMatchObject({ kind: "done", success: false });
    expect(calls.creates).toBe(1);
    expect((await bridge.status(route, true)).conversationId).toBe("conv-1");
  });

  test("a conversation deleted in Letta is replaced on retry", async () => {
    const { client, calls } = fakeClient((_sent, n) => (n === 1 ? new Error("404 Conversation conv-1 not found") : ok("fresh")));
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    await bridge.submit([inbound("m1", "hi")], c.ctx);
    expect(c.events.at(-1)).toMatchObject({ kind: "done", success: true });
    expect(calls.creates).toBe(2);
    expect((await bridge.status(route, true)).conversationId).toBe("conv-2");
  });

  test("reports error after two failures", async () => {
    const { client } = fakeClient(() => new Error("boom"));
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    await bridge.submit([inbound("m1", "hi")], c.ctx);
    const kinds = c.events.map((e) => e.kind);
    expect(kinds).toContain("error");
    expect(c.events.at(-1)).toMatchObject({ kind: "done", success: false });
  });

  test("serializes turns and merges messages queued mid-turn", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => (releaseFirst = r));
    let n = 0;
    const store = new RouteStore(":memory:");
    const { client, calls } = fakeClient(() => ok(`reply ${++n}`));
    const bridge = createAgentBridge(config, { client, store });
    const first = ctxCollector("m1");
    const origOnEvent = first.ctx.onEvent;
    first.ctx.onEvent = (e) => {
      origOnEvent(e);
    };
    // Hold the first turn open by delaying its send.
    const origResume = client.resumeSession.bind(client);
    client.resumeSession = (id, o) => {
      const s = origResume(id, o) as any;
      const origSend = s.send.bind(s);
      s.send = async (m: unknown) => {
        if (calls.sends.length === 0) await gate;
        return origSend(m);
      };
      return s;
    };
    const p1 = bridge.submit([inbound("m1", "one")], first.ctx);
    await Promise.resolve();
    const second = ctxCollector("m2");
    const third = ctxCollector("m3");
    const p2 = bridge.submit([inbound("m2", "two")], second.ctx);
    const p3 = bridge.submit([inbound("m3", "three")], third.ctx);
    expect((await bridge.status(route, false)).busy).toBe(true);
    releaseFirst();
    await Promise.all([p1, p2, p3]);
    expect(calls.sends.length).toBe(2); // m1, then merged m2+m3
    expect(String(calls.sends[1])).toContain("two");
    expect(String(calls.sends[1])).toContain("three");
    expect(second.events).toEqual([{ kind: "merged", intoMessageId: "m3" }]);
    expect(third.events.at(-1)).toMatchObject({ kind: "done", success: true });
  });

  test("cancel aborts the running turn and reports interrupted", async () => {
    const { client, calls } = fakeClient(() => [{ type: "assistant", content: "partial" } as SDKMessage]);
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    const p = bridge.submit([inbound("m1", "long task")], c.ctx);
    // wait until the turn has started streaming
    while (!c.events.some((e) => e.kind === "assistant_delta")) await new Promise((r) => setTimeout(r, 1));
    expect(await bridge.cancel(route)).toBe(true);
    await p;
    expect(calls.aborts).toBe(1);
    expect(c.events.at(-1)).toMatchObject({ kind: "done", success: false, errorCode: "interrupted" });
  });

  test("cancel during session setup stops the turn before anything is sent", async () => {
    let open!: () => void;
    const readyGate = new Promise<void>((r) => (open = r));
    const { client, calls } = fakeClient(() => ok("never sent"), { readyGate });
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    const p = bridge.submit([inbound("m1", "hi")], c.ctx);
    while (calls.resumes === 0) await new Promise((r) => setTimeout(r, 1));
    expect(await bridge.cancel(route)).toBe(true);
    open();
    await p;
    expect(calls.sends).toHaveLength(0);
    expect(c.events.at(-1)).toMatchObject({ kind: "done", success: false, errorCode: "interrupted" });
  });

  test("reset during session setup drops the session bound to the old conversation", async () => {
    let open!: () => void;
    const readyGate = new Promise<void>((r) => (open = r));
    const { client, calls } = fakeClient(() => ok("hello"), { readyGate });
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const first = ctxCollector("m1");
    const p = bridge.submit([inbound("m1", "hi")], first.ctx);
    while (calls.resumes === 0) await new Promise((r) => setTimeout(r, 1));
    await bridge.reset(route);
    open();
    await p;
    expect(calls.sends).toHaveLength(0);
    expect(calls.closes).toBe(1);
    expect(first.events.at(-1)).toMatchObject({ kind: "done", success: false, errorCode: "interrupted" });

    const second = ctxCollector("m2");
    await bridge.submit([inbound("m2", "again")], second.ctx);
    expect(calls.creates).toBe(2);
    expect(calls.resumes).toBe(2);
    expect(second.events.at(-1)).toMatchObject({ kind: "done", success: true });
  });

  test("cancel settles queued turns with interrupted", async () => {
    const { client } = fakeClient(() => [{ type: "assistant", content: "partial" } as SDKMessage]);
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const running = ctxCollector("m1");
    const queued = ctxCollector("m2");
    const p1 = bridge.submit([inbound("m1", "long")], running.ctx);
    while (!running.events.some((e) => e.kind === "assistant_delta")) await new Promise((r) => setTimeout(r, 1));
    const p2 = bridge.submit([inbound("m2", "queued")], queued.ctx);
    expect((await bridge.status(route, false)).queued).toBe(1);
    await bridge.cancel(route);
    await Promise.all([p1, p2]);
    expect(queued.events).toEqual([{ kind: "done", success: false, errorCode: "interrupted", durationMs: 0 }]);
  });

  test("canUseTool routes to the turn's approval callback and respects deny", async () => {
    const { client, calls } = fakeClient(() => ok("x"));
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    let asked = 0;
    c.ctx.requestApproval = async () => {
      asked++;
      return { allow: false, message: "nope" };
    };
    // Capture canUseTool, then invoke it while a turn is "current".
    const origResume = client.resumeSession.bind(client);
    let decision: unknown;
    client.resumeSession = (id, o) => {
      const s = origResume(id, o) as any;
      const origSend = s.send.bind(s);
      s.send = async (m: unknown) => {
        decision = await calls.canUseTool("Bash", { command: "rm -rf /" }, { toolCallId: "t1" });
        return origSend(m);
      };
      return s;
    };
    await bridge.submit([inbound("m1", "do it")], c.ctx);
    expect(asked).toBe(1);
    expect(decision).toEqual({ behavior: "deny", message: "nope" });
  });

  test("reset forgets the mapping; status hides ids for non-admins", async () => {
    const store = new RouteStore(":memory:");
    const { client, calls } = fakeClient(() => ok("hi"));
    const bridge = createAgentBridge(config, { client, store });
    await bridge.submit([inbound("m1", "hello")], ctxCollector().ctx);
    const pub = await bridge.status(route, false);
    expect(pub.hasConversation).toBe(true);
    expect(pub.conversationId).toBeUndefined();
    expect((await bridge.status(route, true)).conversationId).toBe("conv-1");
    await bridge.reset(route);
    expect(store.get("g:c:t")).toBeNull();
    await bridge.submit([inbound("m2", "fresh")], ctxCollector("m2").ctx);
    expect(calls.creates).toBe(2);
  });
});

describe("clientOptions", () => {
  const base = { DISCORD_BOT_TOKEN: "x", LETTA_API_KEY: "k", LETTA_AGENT_ID: "agent-1" };
  test("turn timeout covers approval waits and is configurable", () => {
    expect(clientOptions(loadConfig(base)).requestTimeoutMs).toBe(900_000);
    expect(clientOptions(loadConfig({ ...base, TURN_TIMEOUT_SECONDS: "1800" })).requestTimeoutMs).toBe(1_800_000);
    expect(clientOptions(loadConfig({ ...base, LETTA_COMPUTER: "box" }))).toMatchObject({ computer: "box", requestTimeoutMs: 900_000 });
  });
  test("rejects a turn timeout shorter than the approval timeout", () => {
    expect(() => loadConfig({ ...base, APPROVAL_MODE: "admins", TURN_TIMEOUT_SECONDS: "120", APPROVAL_TIMEOUT_SECONDS: "300" })).toThrow(/TURN_TIMEOUT_SECONDS/);
  });
});


describe("routing table lanes", () => {
  const chanA: RouteKey = { guildId: "g", channelId: "111", threadId: null };
  const threadA: RouteKey = { guildId: "g", channelId: "111", threadId: "112" };
  const chanB: RouteKey = { guildId: "g", channelId: "222", threadId: null };
  const dm: RouteKey = { guildId: null, channelId: "d", threadId: null, userId: "333" };
  const table = parseRoutingTable(
    JSON.stringify({
      routes: [
        { channel: "111", conversation: "conv-shared" },
        { channel: "222", conversation: "conv-shared" },
        { dm: "333", conversation: "default" },
      ],
    }),
  );
  const submit = (bridge: ReturnType<typeof createAgentBridge>, id: string, r: RouteKey) => {
    const c = ctxCollector(id, r);
    return { c, done: bridge.submit([inbound(id, `hi ${id}`, [], r)], c.ctx) };
  };

  test("pinned routes resume the existing conversation and never create one", async () => {
    const store = new RouteStore(":memory:");
    const { client, calls } = fakeClient(() => ok("hi"));
    const bridge = createAgentBridge(config, { client, store, routes: table });
    await submit(bridge, "m1", threadA).done;

    expect(calls.creates).toBe(0);
    expect(calls.resumedIds).toEqual(["conv-shared"]);
    expect(store.get("g:111:112")).toBeNull(); // the table, not the store, owns the mapping
    expect(store.pinnedLastActive("g:111:112")).toBeTruthy(); // follow-ups skip the mention
  });

  test("a default target resumes the agent's default conversation", async () => {
    const { client, calls } = fakeClient(() => ok("hi"));
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:"), routes: table });
    await submit(bridge, "m1", dm).done;
    expect(calls.resumedIds).toEqual(["agent-123"]);
    expect(calls.creates).toBe(0);
  });

  test("routes sharing a conversation share one session, run in turn, and never merge", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client, calls } = fakeClient(() => ok("hi"), { readyGate: gate });
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:"), routes: table });
    const a = submit(bridge, "a1", chanA);
    const b1 = submit(bridge, "b1", chanB);
    const b2 = submit(bridge, "b2", chanB);
    const a2 = submit(bridge, "a2", chanA); // queued behind b1, b2
    release();
    await Promise.all([a.done, b1.done, b2.done, a2.done]);

    expect(calls.resumes).toBe(1);
    // a1 alone, then b1+b2 merged, then a2: a reply never lands in the wrong channel.
    expect(calls.sends).toHaveLength(3);
    expect(String(calls.sends[0])).toContain('chat_id="111"');
    expect(String(calls.sends[0])).not.toContain("hi b1");
    expect(String(calls.sends[1])).toContain('chat_id="222"');
    expect(String(calls.sends[1])).toContain("hi b1");
    expect(String(calls.sends[1])).toContain("hi b2");
    expect(String(calls.sends[1])).not.toContain("hi a2");
    expect(String(calls.sends[2])).toContain('chat_id="111"');
    expect(b1.c.events).toEqual([{ kind: "merged", intoMessageId: "b2" }]);
    expect(a2.c.events.at(-1)).toMatchObject({ kind: "done", success: true });
  });

  test("a missing pinned conversation fails loudly instead of being replaced", async () => {
    const { client, calls } = fakeClient(() => new Error("Conversation conv-shared not found (404)"));
    const store = new RouteStore(":memory:");
    const bridge = createAgentBridge(config, { client, store, routes: table });
    const a = submit(bridge, "m1", chanA);
    await a.done;

    expect(calls.creates).toBe(0);
    expect(calls.sends).toHaveLength(1); // no retry against a fresh conversation
    expect(a.c.events).toContainEqual({ kind: "error", message: "Pinned conversation conv-shared (channel:111) was not found." });
    expect(a.c.events.at(-1)).toMatchObject({ kind: "done", success: false });
  });

  test("/new leaves pinned routes alone; /cancel only touches its own route", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client, calls } = fakeClient(() => ok("hi"), { readyGate: gate });
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:"), routes: table });
    expect(await bridge.reset(chanA)).toBe("pinned");
    expect(await bridge.reset(route)).toBe("reset");

    const a = submit(bridge, "a1", chanA);
    const b = submit(bridge, "b1", chanB);
    await new Promise((r) => setTimeout(r, 5));
    expect(await bridge.cancel(chanB)).toBe(true); // drops b1 from the queue
    release();
    await Promise.all([a.done, b.done]);

    expect(b.c.events).toEqual([{ kind: "done", success: false, errorCode: "interrupted", durationMs: 0 }]);
    expect(a.c.events.at(-1)).toMatchObject({ kind: "done", success: true }); // a1 was not aborted
    expect(calls.aborts).toBe(0);
    expect(await bridge.status(chanA, true)).toMatchObject({ pinnedBy: "channel:111", conversationId: "conv-shared" });
  });

  test("the session is rebuilt when a shared lane switches reply modes", async () => {
    const toolConfig = loadConfig({
      DISCORD_BOT_TOKEN: "x",
      LETTA_API_KEY: "y",
      LETTA_AGENT_ID: "agent-123",
      SESSION_IDLE_MINUTES: "0",
      DISCORD_OPEN_CHANNEL_IDS: "111",
      OPEN_CHANNEL_REPLY_MODE: "tool",
    });
    const built: string[][] = [];
    const { client, calls } = fakeClient(() => ok("hi"));
    const bridge = createAgentBridge(toolConfig, {
      client,
      store: new RouteStore(":memory:"),
      routes: table,
      toolFactory: (r) => {
        const names = r.channelId === "111" ? ["discord_send_message"] : [];
        built.push(names);
        return names.map((name) => ({ name }) as never);
      },
    });
    await submit(bridge, "a1", chanA).done; // tool mode
    await submit(bridge, "a2", chanA).done; // same mode, same session
    await submit(bridge, "b1", chanB).done; // relay: new session

    expect(calls.resumes).toBe(2);
    expect(built).toEqual([["discord_send_message"], []]);
  });
});

describe("run tracking", () => {
  const echo = (otid: string | undefined, run: string) =>
    ({ type: "stream_event", event: { message_type: "user_message", otid, run_id: run } }) as unknown as SDKMessage;
  const say = (runId: string, content: string) => ({ type: "assistant", content, runId }) as unknown as SDKMessage;
  const status = (s: string, runs: string[] = []) => ({ type: "loop_status", status: s, activeRunIds: runs }) as unknown as SDKMessage;
  const result = (runIds: string[]) => ({ type: "result", success: true, durationMs: 5, runIds }) as unknown as SDKMessage;
  const texts = (events: TurnEvent[]) => events.flatMap((e) => (e.kind === "assistant_delta" ? [e.text] : []));

  test("a task-notification turn ahead of ours is not posted, and our reply is", async () => {
    const store = new RouteStore(":memory:");
    // Mirrors the 2026-10-07 overlap capture: the notification's run and result
    // arrive first, then our run, which ends with no result of its own.
    const { client } = fakeClient((_m, _n, otid) => [
      echo("note-1", "tn"),
      status("PROCESSING_API_RESPONSE", ["tn"]),
      say("tn", "The password search finished."),
      result(["tn"]),
      echo(otid, "b"),
      status("PROCESSING_API_RESPONSE", ["b"]),
      say("b", "Yes, I see it."),
      status("WAITING_ON_INPUT"),
    ]);
    const bridge = createAgentBridge(config, { client, store });
    const a = ctxCollector("m1");
    await bridge.submit([inbound("m1", "Do you see what I am replying to")], a.ctx);
    expect(texts(a.events)).toEqual(["Yes, I see it."]);
    const done = a.events.filter((e) => e.kind === "done");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ success: true });
  });

  test("background subagent output in our turn is dropped", async () => {
    const store = new RouteStore(":memory:");
    const { client } = fakeClient((_m, _n, otid) => [
      echo(otid, "a"),
      say("a", "Searching."),
      say("subagent-run", "**Direct answer.** Yes."),
      status("PROCESSING_API_RESPONSE", ["a2"]),
      say("a2", "Done."),
      // The SDK lists every run that streamed during its turn, subagents included.
      result(["a", "subagent-run", "a2"]),
    ]);
    const bridge = createAgentBridge(config, { client, store });
    const a = ctxCollector("m1");
    await bridge.submit([inbound("m1", "?")], a.ctx);
    expect(texts(a.events)).toEqual(["Searching.", "Done."]);
  });
});
