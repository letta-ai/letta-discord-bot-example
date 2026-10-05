import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";
import { loadConfig } from "../src/config.ts";
import {
  checkLetta,
  checkMessageContentIntent,
  computeEffectivePermissions,
  formatCheck,
  runDoctor,
} from "../src/doctor.ts";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function config(overrides: Record<string, string> = {}) {
  return loadConfig({
    DISCORD_BOT_TOKEN: "discord-secret",
    LETTA_API_KEY: "letta-secret",
    LETTA_AGENT_ID: "agent-test",
    DATA_DIR: "/tmp/letta-discord-doctor-test",
    ...overrides,
  });
}

describe("doctor Message Content intent", () => {
  test("accepts full or limited intent flags", () => {
    expect(checkMessageContentIntent(1 << 18).status).toBe("PASS");
    expect(checkMessageContentIntent(1 << 19).status).toBe("PASS");
  });

  test("fails when neither intent flag is set", () => {
    const check = checkMessageContentIntent(0);
    expect(check.status).toBe("FAIL");
    expect(check.hint).toContain("Developer Portal");
  });
});

test("channel overwrite can deny Send Messages", () => {
  const permissions = computeEffectivePermissions({
    guildId: "guild",
    botId: "bot",
    memberRoleIds: ["role"],
    roles: [
      {
        id: "guild",
        permissions: (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages).toString(),
      },
      { id: "role", permissions: "0" },
    ],
    overwrites: [
      {
        id: "role",
        type: 0,
        allow: "0",
        deny: PermissionFlagsBits.SendMessages.toString(),
      },
    ],
  });

  expect(permissions.has(PermissionFlagsBits.ViewChannel)).toBe(true);
  expect(permissions.has(PermissionFlagsBits.SendMessages)).toBe(false);
});

describe("Letta doctor hints", () => {
  test("distinguishes an invalid key from a missing agent", async () => {
    const unauthorized = await checkLetta((async () => response({}, 401)) as unknown as typeof fetch, config());
    const missing = await checkLetta((async () => response({}, 404)) as unknown as typeof fetch, config());

    expect(unauthorized.status).toBe("FAIL");
    expect(unauthorized.hint).toContain("LETTA_API_KEY");
    expect(unauthorized.hint).not.toContain("LETTA_AGENT_ID");
    expect(missing.status).toBe("FAIL");
    expect(missing.hint).toContain("LETTA_AGENT_ID");
    expect(missing.hint).toContain("same Letta project");
  });
});

test("doctor output never contains configured secret values", async () => {
  const discordSecret = "discord-top-secret";
  const lettaSecret = "letta-top-secret";
  const fakeFetch = (async (request: Parameters<typeof fetch>[0]) => {
    const url = String(request);
    if (url.endsWith("/users/@me")) return response({ id: "bot", username: "safe-bot" });
    if (url.endsWith("/applications/@me")) return response({ id: "app", flags: 1 << 18 });
    if (url.endsWith("/users/@me/guilds")) return response([]);
    if (url.includes("/v1/agents/")) return response({ name: lettaSecret, model: discordSecret });
    throw new Error(`unexpected request using ${discordSecret}`);
  }) as typeof fetch;

  const checks = await runDoctor({
    fetch: fakeFetch,
    env: {
      DISCORD_BOT_TOKEN: discordSecret,
      LETTA_API_KEY: lettaSecret,
      LETTA_AGENT_ID: "agent-test",
      DATA_DIR: "/tmp/letta-discord-doctor-secret-test",
    },
  });
  const output = checks.map(formatCheck).join("\n");

  expect(output).not.toContain(discordSecret);
  expect(output).not.toContain(lettaSecret);
  expect(output).toContain("[REDACTED]");
});

test("a rejected Letta key is not reported as an unregistered computer", async () => {
  const fakeFetch = (async (request: Parameters<typeof fetch>[0]) => {
    const url = String(request);
    if (url.endsWith("/users/@me")) return response({ id: "bot", username: "bot" });
    if (url.endsWith("/applications/@me")) return response({ id: "app", flags: 1 << 18 });
    if (url.endsWith("/users/@me/guilds")) return response([]);
    if (url.includes("/v1/agents/")) return response({ detail: "unauthorized" }, 401);
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;

  const checks = await runDoctor({
    fetch: fakeFetch,
    computerResolver: async () => {
      throw new Error("unauthorized");
    },
    env: {
      DISCORD_BOT_TOKEN: "discord-secret",
      LETTA_API_KEY: "letta-bad",
      LETTA_AGENT_ID: "agent-test",
      LETTA_COMPUTER: "my-laptop",
      DATA_DIR: "/tmp/letta-discord-doctor-auth-test",
    },
  });
  const computer = checks.find((check) => check.check === "Letta computer");

  expect(computer?.status).toBe("FAIL");
  expect(computer?.hint).toContain("LETTA_API_KEY");
  expect(computer?.hint).not.toContain("LETTA_COMPUTER");
});
