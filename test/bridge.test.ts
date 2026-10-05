import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@letta-ai/letta-agent-sdk";
import { loadConfig } from "../src/config.ts";
import { createAgentBridge, type LettaClientLike } from "../src/letta/bridge.ts";
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

function inbound(id: string, text: string, files: InboundMessage["files"] = []): InboundMessage {
  return {
    route,
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

type Script = (sent: unknown, n: number) => SDKMessage[] | Error;

function fakeClient(script: Script, opts: { failReadyOnce?: boolean; noSandbox?: boolean } = {}) {
  const calls = { creates: 0, resumes: 0, sends: [] as unknown[], closes: 0, aborts: 0, uploads: [] as string[], canUseTool: null as any };
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
          if (readyFails > 0) {
            readyFails--;
            throw new Error("socket closed");
          }
          return { model: "test/model" };
        },
        async send(m: unknown) {
          calls.sends.push(m);
          const r = script(m, calls.sends.length);
          if (r instanceof Error) throw r;
          queue = r;
        },
        async *stream() {
          while (queue.length) {
            const next = queue.shift()!;
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

function ctxCollector(id = "m1"): { ctx: TurnContext; events: TurnEvent[] } {
  const events: TurnEvent[] = [];
  return {
    events,
    ctx: {
      route,
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
    const file = { name: "voice-message.ogg", url: "https://cdn/v", contentType: "audio/ogg", size: 3, data: new Blob(["ogg"]), voice: true, durationSecs: 2, transcript: "deploy the thing" };
    await bridge.submit([inbound("m1", "", [file])], ctxCollector().ctx);
    expect(String(calls.sends[0])).toContain('voice="true"');
    expect(String(calls.sends[0])).toContain("<transcript>deploy the thing</transcript>");
  });

  test("retries once after a session failure before any text", async () => {
    const { client, calls } = fakeClient(() => ok("recovered"), { failReadyOnce: true });
    const bridge = createAgentBridge(config, { client, store: new RouteStore(":memory:") });
    const c = ctxCollector();
    await bridge.submit([inbound("m1", "hi")], c.ctx);
    expect(calls.resumes).toBe(2);
    expect(c.events.at(-1)).toMatchObject({ kind: "done", success: true });
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
