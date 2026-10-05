import { describe, expect, test } from "bun:test";
import { toolLabel } from "../src/letta/bridge.ts";

describe("toolLabel", () => {
  test("prefers the tool call's own description", () => {
    expect(toolLabel("Bash", { command: "uname -a; echo; whoami; pwd", description: "Check system info" })).toBe(
      "Check system info",
    );
  });
  test("falls back to name plus primary argument", () => {
    expect(toolLabel("Read", { file_path: "/root/README.md" })).toBe("Read /root/README.md");
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
