import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@letta-ai/letta-agent-sdk";
import { BackgroundRuns, RunTracker, type RunVerdict } from "../src/letta/run-tracker.ts";

// Sequences reduced from live captures on 2026-10-07 (conv-97211ad9, conv-c0f0…).
const echo = (otid: string, run?: string) =>
  ({ type: "stream_event", event: { message_type: "user_message", otid, ...(run ? { run_id: run } : {}) } }) as unknown as SDKMessage;
const status = (s: string, runs: string[] = []) => ({ type: "loop_status", status: s, activeRunIds: runs }) as unknown as SDKMessage;
const say = (runId: string, content = "x") => ({ type: "assistant", content, runId }) as unknown as SDKMessage;
const tool = (runId: string) => ({ type: "tool_call", toolCallId: "t", toolName: "Agent", runId }) as unknown as SDKMessage;
const result = (runIds: string[]) => ({ type: "result", success: true, runIds }) as unknown as SDKMessage;

const run = (t: RunTracker, msgs: SDKMessage[]): RunVerdict[] => msgs.map((m) => t.see(m));

describe("RunTracker", () => {
  test("a continuation run after a client tool stays ours; a subagent run is dropped", () => {
    const t = new RunTracker("cap-A", true);
    expect(
      run(t, [
        echo("cap-A", "r1"),
        tool("r1"),
        status("SENDING_API_REQUEST", ["r1"]),
        status("PROCESSING_API_RESPONSE", ["r2"]), // continuation: no echo
        say("r2", "launched"),
        say("sub", "**Direct answer.**"), // subagent: never in loop_status
        result(["r1", "r2"]),
      ]),
    ).toEqual(["pass", "pass", "pass", "pass", "pass", "hold", "pass"]);
    expect(t.release()).toEqual([]);
    expect(t.unclaimed()).toEqual(["sub"]);
  });

  test("a task-notification turn queued ahead of ours is skipped, and ours ends without a result", () => {
    const t = new RunTracker("cap-B", true);
    expect(
      run(t, [
        echo("note-1"), // queued copy, no run yet
        status("PROCESSING_API_RESPONSE", ["tn"]),
        echo("note-1", "tn"),
        say("tn", "Pineapple showed up today..."),
        result(["tn"]),
        echo("cap-B"),
        status("PROCESSING_API_RESPONSE", ["b"]),
        echo("cap-B", "b"),
        say("b", "B"),
        status("WAITING_ON_INPUT"),
      ]),
    ).toEqual(["pass", "pass", "pass", "foreign", "skip-result", "pass", "pass", "pass", "pass", "end"]);
  });

  test("a foreign run that starts during our turn is reclassified by its echo", () => {
    const t = new RunTracker("me", true);
    run(t, [echo("me", "a"), status("PROCESSING_API_RESPONSE", ["n"])]);
    expect(t.ours.has("n")).toBe(true);
    t.see(echo("note", "n"));
    expect(t.ours.has("n")).toBe(false);
    expect(t.see(say("n"))).toBe("foreign");
  });

  test("stale output buffered before our echo is dropped", () => {
    const t = new RunTracker("me", true);
    expect(run(t, [say("old", "leftover"), result(["old"]), echo("me", "a"), say("a", "hi"), result(["a"])])).toEqual([
      "hold",
      "skip-result",
      "pass",
      "pass",
      "pass",
    ]);
  });

  test("without echoes, everything passes through as before", () => {
    const t = new RunTracker("me", false);
    expect(run(t, [say("x"), tool("y"), result(["z"])])).toEqual(["pass", "pass", "pass"]);
  });

  test("an early WAITING_ON_INPUT before our run starts does not end the turn", () => {
    const t = new RunTracker("me", true);
    expect(run(t, [status("WAITING_ON_INPUT"), result(["old"]), status("WAITING_ON_INPUT")])).toEqual(["pass", "skip-result", "pass"]);
  });

  test("a notification injected into our in-progress run keeps the run ours", () => {
    // e2e 2026-10-07 conv-45af645c: task_5's notification was echoed inside our
    // continuation run 0da7102f after its tool result.
    const t = new RunTracker("me", true);
    run(t, [echo("me", "a"), status("PROCESSING_API_RESPONSE", ["c"]), tool("c")]);
    expect(t.see(echo("note", "c"))).toBe("pass");
    expect(t.see(say("c", "The pineapple search finished."))).toBe("pass");
  });

  test("our text that arrives before our echo is held, then released in order", () => {
    // Suspected order in e2e conv-45af645c turn 3: "three" was dropped though its run was ours.
    const t = new RunTracker("me", true);
    expect(t.see(say("a", "thr"))).toBe("hold");
    expect(t.see(say("a", "ee"))).toBe("hold");
    expect(t.see(echo("me", "a"))).toBe("pass");
    expect(t.release().map((m) => (m as { content: string }).content)).toEqual(["thr", "ee"]);
    expect(t.see(say("a", "!"))).toBe("pass");
  });

  test("a subagent run listed in our result stays unclaimed", () => {
    // e2e conv for t-1791403518107: the SDK's result listed the recall subagent's
    // run alongside ours, and its "Direct answer" must not be posted.
    const t = new RunTracker("me", true);
    run(t, [echo("me", "a"), say("sub", "**Direct answer.**")]);
    expect(t.see(result(["a", "sub"]))).toBe("pass");
    expect(t.release()).toEqual([]);
    expect(t.unclaimed()).toEqual(["sub"]);
  });

  test("held output for a run later echoed as the agent's own goes to releaseForeign", () => {
    const t = new RunTracker("me", true);
    run(t, [echo("me", "a"), say("n", "note text")]);
    t.see(echo("note", "n"));
    expect(t.release()).toEqual([]);
    expect(t.releaseForeign().map((m) => (m as { content: string }).content)).toEqual(["note text"]);
    expect(t.unclaimed()).toEqual([]);
  });
});

describe("BackgroundRuns", () => {
  test("posts runs started by the agent's own inputs, not Discord turns or subagents", () => {
    const b = new BackgroundRuns();
    expect(b.see(echo("task-note", "n"))).toBe("ignore");
    expect(b.see(say("n", "slept"))).toBe("post");
    expect(b.see(say("sub", "**Direct answer.**"))).toBe("ignore");
    expect(b.see(echo("discord-x", "d"))).toBe("ignore");
    expect(b.see(say("d", "turn text"))).toBe("ignore");
    expect(b.see(status("WAITING_ON_INPUT"))).toBe("end");
  });

  test("continuation runs listed in loop_status are posted", () => {
    const b = new BackgroundRuns();
    b.see(echo("task-note", "n"));
    b.see(status("PROCESSING_API_RESPONSE", ["n2"]));
    expect(b.see(say("n2", "more"))).toBe("post");
    expect(b.see(result(["n", "n2"]))).toBe("end");
  });
});

