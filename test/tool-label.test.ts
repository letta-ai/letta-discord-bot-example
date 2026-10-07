import { describe, expect, test } from "bun:test";
import { toolLabel } from "../src/letta/bridge.ts";

describe("toolLabel", () => {
  test("prefers the tool call's own description", () => {
    expect(toolLabel("Bash", { command: "uname -a; echo; whoami; pwd", description: "Check system info" })).toBe(
      "Check system info",
    );
  });
  test("falls back to name plus primary argument", () => {
    expect(toolLabel("Bash", { command: "bun test" })).toBe("Bash bun test");
  });
  test("shows paths as their file name", () => {
    expect(toolLabel("Read", { file_path: "/Users/cameron/.letta/agents/agent-1/memory/human.md" })).toBe("Read human.md");
    expect(toolLabel("Glob", { path: "/root/src/" })).toBe("Glob src");
  });
  test("falls back to the bare tool name", () => {
    expect(toolLabel("memory", {})).toBe("memory");
  });
  test("collapses whitespace and truncates long labels", () => {
    const l = toolLabel("Bash", { description: `a\n${"x".repeat(200)}` });
    expect(l.includes("\n")).toBe(false);
    expect(l.length).toBeLessThanOrEqual(100);
    expect(l.endsWith("...")).toBe(true);
  });
});

import { assistantMessageId } from "../src/letta/bridge.ts";

describe("assistantMessageId", () => {
  test("uses the server message id", () => {
    expect(assistantMessageId({ uuid: "message-abc", otid: "o1" })).toBe("message-abc");
  });
  test("ignores SDK-generated per-chunk uuids and falls back to otid", () => {
    expect(assistantMessageId({ uuid: "session-7", otid: "o1" })).toBe("otid:o1");
  });
  test("undefined when neither is stable", () => {
    expect(assistantMessageId({ uuid: "session-7" })).toBeUndefined();
  });
});
