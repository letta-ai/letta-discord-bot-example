import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { loadConfig, type Config } from "./config.ts";
import { readFileSync } from "node:fs";
import { parseRoutingTable, pinnedConversations, type RoutingTable } from "./routing.ts";

export type CheckStatus = "PASS" | "WARN" | "FAIL";

export interface CheckResult {
  status: CheckStatus;
  check: string;
  message: string;
  hint: string;
}

interface DiscordUser {
  id: string;
  username?: string;
  discriminator?: string;
}

interface DiscordApplication {
  id: string;
  flags?: number;
}

interface DiscordGuild {
  id: string;
  name?: string;
}

interface DiscordRole {
  id: string;
  permissions: string;
}

interface DiscordMember {
  roles?: string[];
}

interface DiscordOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

interface DiscordChannel {
  id: string;
  name?: string;
  type?: number;
  guild_id?: string;
  parent_id?: string | null;
  permission_overwrites?: DiscordOverwrite[];
}

export interface PermissionInput {
  guildId: string;
  botId: string;
  memberRoleIds: string[];
  roles: DiscordRole[];
  overwrites?: DiscordOverwrite[];
}

export type DoctorFetch = typeof fetch;

const DISCORD_API = "https://discord.com/api/v10";
const MESSAGE_CONTENT = 1 << 18;
const MESSAGE_CONTENT_LIMITED = 1 << 19;

export const REQUIRED_PERMISSIONS = {
  "View Channel": PermissionFlagsBits.ViewChannel,
  "Send Messages": PermissionFlagsBits.SendMessages,
  "Send Messages in Threads": PermissionFlagsBits.SendMessagesInThreads,
  "Create Public Threads": PermissionFlagsBits.CreatePublicThreads,
  "Read Message History": PermissionFlagsBits.ReadMessageHistory,
  "Add Reactions": PermissionFlagsBits.AddReactions,
  "Attach Files": PermissionFlagsBits.AttachFiles,
  "Embed Links": PermissionFlagsBits.EmbedLinks,
} as const;

const INVITE_PERMISSIONS = new PermissionsBitField(Object.values(REQUIRED_PERMISSIONS)).bitfield;

function result(status: CheckStatus, check: string, message: string, hint: string): CheckResult {
  return { status, check, message, hint };
}

function safeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return clean || fallback;
}

async function json<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

async function discordGet<T>(fetchImpl: DoctorFetch, token: string, path: string): Promise<{ response: Response; body?: T }> {
  const response = await fetchImpl(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  return { response, body: await json<T>(response) };
}

export function checkMessageContentIntent(flags: number | undefined): CheckResult {
  const enabled = typeof flags === "number" && (flags & (MESSAGE_CONTENT | MESSAGE_CONTENT_LIMITED)) !== 0;
  return enabled
    ? result("PASS", "Message Content intent", "enabled for the Discord application", "No action needed.")
    : result(
        "FAIL",
        "Message Content intent",
        "not enabled for the Discord application",
        "Enable Message Content Intent on the Discord Developer Portal Bot page.",
      );
}

export function buildInviteUrl(applicationId: string): string {
  const query = new URLSearchParams({
    client_id: applicationId,
    permissions: INVITE_PERMISSIONS.toString(),
    scope: "bot applications.commands",
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

/** Compute Discord guild-channel permissions using the documented overwrite order. */
export function computeEffectivePermissions(input: PermissionInput): PermissionsBitField {
  const everyone = input.roles.find((role) => role.id === input.guildId);
  let bits = new PermissionsBitField(everyone ? BigInt(everyone.permissions) : 0n);
  for (const role of input.roles) {
    if (input.memberRoleIds.includes(role.id)) bits.add(BigInt(role.permissions));
  }

  if (bits.has(PermissionFlagsBits.Administrator)) return new PermissionsBitField(PermissionsBitField.All);

  const overwrites = input.overwrites ?? [];
  const everyoneOverwrite = overwrites.find((overwrite) => overwrite.type === 0 && overwrite.id === input.guildId);
  if (everyoneOverwrite) {
    bits.remove(BigInt(everyoneOverwrite.deny));
    bits.add(BigInt(everyoneOverwrite.allow));
  }

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type === 0 && input.memberRoleIds.includes(overwrite.id)) {
      roleAllow |= BigInt(overwrite.allow);
      roleDeny |= BigInt(overwrite.deny);
    }
  }
  bits.remove(roleDeny);
  bits.add(roleAllow);

  const memberOverwrite = overwrites.find((overwrite) => overwrite.type === 1 && overwrite.id === input.botId);
  if (memberOverwrite) {
    bits.remove(BigInt(memberOverwrite.deny));
    bits.add(BigInt(memberOverwrite.allow));
  }
  return bits;
}

export async function checkDiscordToken(fetchImpl: DoctorFetch, token: string): Promise<{ check: CheckResult; user?: DiscordUser }> {
  try {
    const { response, body } = await discordGet<DiscordUser>(fetchImpl, token, "/users/@me");
    if (!response.ok || !body?.id) {
      return {
        check: result(
          "FAIL",
          "Discord token",
          `Discord rejected the bot credentials (HTTP ${response.status})`,
          "Reset the bot token in the Developer Portal and update DISCORD_BOT_TOKEN.",
        ),
      };
    }
    const discriminator = body.discriminator && body.discriminator !== "0" ? `#${body.discriminator}` : "";
    return {
      check: result("PASS", "Discord token", `authenticated as ${safeName(body.username, "bot")}${discriminator}`, "No action needed."),
      user: body,
    };
  } catch {
    return {
      check: result("FAIL", "Discord token", "could not reach the Discord API", "Check network access to discord.com and try again."),
    };
  }
}

export async function checkDiscordApplication(
  fetchImpl: DoctorFetch,
  token: string,
): Promise<{ checks: CheckResult[]; application?: DiscordApplication }> {
  try {
    const { response, body } = await discordGet<DiscordApplication>(fetchImpl, token, "/applications/@me");
    if (!response.ok || !body?.id) {
      return {
        checks: [
          result(
            "FAIL",
            "Discord application",
            `could not inspect the application (HTTP ${response.status})`,
            "Verify DISCORD_BOT_TOKEN belongs to a Discord application bot.",
          ),
        ],
      };
    }
    return {
      application: body,
      checks: [
        checkMessageContentIntent(body.flags),
        result("PASS", "Invite URL", buildInviteUrl(body.id), "Open this URL to install or update the bot permissions."),
      ],
    };
  } catch {
    return {
      checks: [result("FAIL", "Discord application", "could not reach the Discord API", "Check network access to discord.com and try again.")],
    };
  }
}

export async function checkGuildMembership(fetchImpl: DoctorFetch, token: string, configuredGuildIds: string[]): Promise<CheckResult[]> {
  try {
    const { response, body } = await discordGet<DiscordGuild[]>(fetchImpl, token, "/users/@me/guilds");
    if (!response.ok || !Array.isArray(body)) {
      return [
        result(
          "FAIL",
          "Guild membership",
          `could not list bot guilds (HTTP ${response.status})`,
          "Reinstall the bot with the generated invite URL.",
        ),
      ];
    }
    const checks: CheckResult[] = [];
    checks.push(
      body.length > 0
        ? result("PASS", "Guild membership", `bot is installed in ${body.length} guild${body.length === 1 ? "" : "s"}`, "No action needed.")
        : result("FAIL", "Guild membership", "bot is not installed in any guild", "Open the generated invite URL and install the bot."),
    );
    const joined = new Set(body.map((guild) => guild.id));
    for (const guildId of configuredGuildIds) {
      checks.push(
        joined.has(guildId)
          ? result("PASS", `Configured guild ${guildId}`, "bot is a member", "No action needed.")
          : result("FAIL", `Configured guild ${guildId}`, "bot is not a member", "Install the bot in this guild or remove it from DISCORD_GUILD_IDS."),
      );
    }
    return checks;
  } catch {
    return [result("FAIL", "Guild membership", "could not reach the Discord API", "Check network access to discord.com and try again.")];
  }
}

function missingPermissionNames(permissions: PermissionsBitField): string[] {
  return Object.entries(REQUIRED_PERMISSIONS)
    .filter(([, bit]) => !permissions.has(bit))
    .map(([name]) => name);
}

export async function checkChannelPermissions(
  fetchImpl: DoctorFetch,
  token: string,
  botId: string,
  channelIds: string[],
): Promise<CheckResult[]> {
  const guildCache = new Map<string, Promise<{ member?: DiscordMember; roles?: DiscordRole[] }>>();
  const loadGuild = (guildId: string) => {
    let pending = guildCache.get(guildId);
    if (!pending) {
      pending = (async () => {
        const [member, roles] = await Promise.all([
          discordGet<DiscordMember>(fetchImpl, token, `/guilds/${guildId}/members/${botId}`),
          discordGet<DiscordRole[]>(fetchImpl, token, `/guilds/${guildId}/roles`),
        ]);
        return {
          member: member.response.ok ? member.body : undefined,
          roles: roles.response.ok && Array.isArray(roles.body) ? roles.body : undefined,
        };
      })();
      guildCache.set(guildId, pending);
    }
    return pending;
  };

  const checks: CheckResult[] = [];
  for (const channelId of [...new Set(channelIds)]) {
    try {
      const channelResponse = await discordGet<DiscordChannel>(fetchImpl, token, `/channels/${channelId}`);
      const channel = channelResponse.body;
      if (!channelResponse.response.ok || !channel?.id) {
        checks.push(
          result(
            "FAIL",
            `Channel ${channelId}`,
            `could not fetch the channel (HTTP ${channelResponse.response.status})`,
            "Check the channel ID and grant the bot View Channel.",
          ),
        );
        continue;
      }
      if (!channel.guild_id) {
        checks.push(result("WARN", `Channel ${channelId}`, "is not a guild channel; permissions were not computed", "Use a guild channel ID."));
        continue;
      }

      let overwrites = channel.permission_overwrites ?? [];
      if ([10, 11, 12].includes(channel.type ?? -1) && channel.parent_id) {
        const parent = await discordGet<DiscordChannel>(fetchImpl, token, `/channels/${channel.parent_id}`);
        if (parent.response.ok && parent.body) overwrites = parent.body.permission_overwrites ?? [];
      }
      const guild = await loadGuild(channel.guild_id);
      if (!guild.member || !guild.roles) {
        checks.push(
          result(
            "FAIL",
            `Channel ${channelId}`,
            "could not load the bot member or guild roles",
            "Verify the bot is still installed in the channel's guild.",
          ),
        );
        continue;
      }
      const permissions = computeEffectivePermissions({
        guildId: channel.guild_id,
        botId,
        memberRoleIds: guild.member.roles ?? [],
        roles: guild.roles,
        overwrites,
      });
      const missing = missingPermissionNames(permissions);
      const label = safeName(channel.name, channelId);
      if (missing.length === 0) {
        checks.push(result("PASS", `Channel ${label}`, "all required permissions are effective", "No action needed."));
      } else {
        const coreMissing = missing.includes("View Channel") || missing.includes("Send Messages");
        checks.push(
          result(
            coreMissing ? "FAIL" : "WARN",
            `Channel ${label}`,
            `missing: ${missing.join(", ")}`,
            `Update the bot role or channel overwrites to grant ${missing.join(", ")}.`,
          ),
        );
      }
    } catch {
      checks.push(result("FAIL", `Channel ${channelId}`, "could not inspect permissions", "Check Discord connectivity and the channel ID."));
    }
  }
  return checks;
}

function lettaBase(config: Config): string {
  return (config.LETTA_BASE_URL ?? "https://api.letta.com").replace(/\/+$/, "");
}

export async function checkLetta(fetchImpl: DoctorFetch, config: Config): Promise<CheckResult> {
  try {
    const response = await fetchImpl(`${lettaBase(config)}/v1/agents/${encodeURIComponent(config.LETTA_AGENT_ID)}`, {
      headers: { Authorization: `Bearer ${config.LETTA_API_KEY}` },
    });
    if (response.status === 401 || response.status === 403) {
      return result("FAIL", "Letta agent", `authentication failed (HTTP ${response.status})`, "Replace LETTA_API_KEY with a valid key for this Letta project.");
    }
    if (response.status === 404) {
      return result(
        "FAIL",
        "Letta agent",
        "agent was not found (HTTP 404)",
        "Check LETTA_AGENT_ID and confirm the API key belongs to the same Letta project.",
      );
    }
    if (!response.ok) {
      return result("FAIL", "Letta agent", `request failed (HTTP ${response.status})`, "Check LETTA_BASE_URL and Letta service availability.");
    }
    const agent = (await json<Record<string, unknown>>(response)) ?? {};
    const llmConfig = typeof agent.llm_config === "object" && agent.llm_config ? (agent.llm_config as Record<string, unknown>) : undefined;
    const modelObject = typeof agent.model === "object" && agent.model ? (agent.model as Record<string, unknown>) : undefined;
    const name = safeName(agent.name, config.LETTA_AGENT_ID);
    const model = safeName(typeof agent.model === "string" ? agent.model : modelObject?.name ?? llmConfig?.model, "model not reported");
    return result("PASS", "Letta agent", `${name} (${model})`, "No action needed.");
  } catch {
    return result("FAIL", "Letta agent", "could not reach the Letta API", "Check LETTA_BASE_URL and network access, then try again.");
  }
}

/**
 * ROUTES_FILE must parse, and every pinned conversation must exist and belong
 * to LETTA_AGENT_ID. At runtime a missing pinned conversation fails turns
 * rather than being replaced, so catch it here first.
 */
export async function checkRoutingTable(fetchImpl: DoctorFetch, config: Config, readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): Promise<CheckResult[]> {
  if (!config.ROUTES_FILE) return [];
  let table: RoutingTable;
  try {
    table = parseRoutingTable(readFile(config.ROUTES_FILE), config.ROUTES_FILE);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n").map((l) => l.trim()).join(" ") : String(error);
    return [result("FAIL", "Routing table", message, "Fix ROUTES_FILE; the listener refuses to start with an invalid table.")];
  }
  const results: CheckResult[] = [
    result("PASS", "Routing table", `${table.routes.length} rule(s), fallback ${table.fallback ?? "auto"}`, "No action needed."),
  ];
  const policies = [
    ...(table.policy ? [["all routes", table.policy] as const] : []),
    ...table.routes.flatMap((e) => (e.policy ? [[describeRule(e), e.policy] as const] : [])),
  ];
  for (const [rule, policy] of policies) {
    const parts = Object.entries(policy).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") || "(toolset defaults)" : v}`);
    results.push(result("PASS", `Tool policy ${rule}`, parts.join(", ") || "inherits everything", "No action needed."));
  }
  const noAdmins = config.DISCORD_ADMIN_USER_IDS.length === 0 && config.DISCORD_ADMIN_ROLE_IDS.length === 0;
  const adminOnly = policies.filter(([, p]) => p.approvalMode === "admins").map(([rule]) => rule);
  if (noAdmins && adminOnly.length > 0) {
    results.push(
      result(
        "WARN",
        "Tool policy approvals",
        `approvalMode admins on ${adminOnly.join(", ")} but no admin users or roles are configured, so tool calls needing approval are denied there`,
        "Set DISCORD_ADMIN_USER_IDS or DISCORD_ADMIN_ROLE_IDS, or choose another approvalMode.",
      ),
    );
  }
  for (const id of pinnedConversations(table)) {
    const check = `Pinned ${id}`;
    if (id === "default") {
      results.push(result("PASS", check, "the agent's default conversation", "No action needed."));
      continue;
    }
    try {
      const response = await fetchImpl(`${lettaBase(config)}/v1/conversations/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${config.LETTA_API_KEY}` },
      });
      if (response.status === 404) {
        results.push(result("FAIL", check, "conversation was not found (HTTP 404)", "Fix the id in ROUTES_FILE, or confirm the API key belongs to the same Letta project."));
        continue;
      }
      if (!response.ok) {
        results.push(result("FAIL", check, `request failed (HTTP ${response.status})`, "Check LETTA_API_KEY and LETTA_BASE_URL."));
        continue;
      }
      const conversation = (await json<{ agent_id?: string }>(response)) ?? {};
      results.push(
        conversation.agent_id && conversation.agent_id !== config.LETTA_AGENT_ID
          ? result("FAIL", check, `belongs to ${conversation.agent_id}, not LETTA_AGENT_ID`, "Pin only conversations of the configured agent.")
          : result("PASS", check, "conversation exists", "No action needed."),
      );
    } catch {
      results.push(result("FAIL", check, "could not reach the Letta API", "Check LETTA_BASE_URL and network access, then try again."));
    }
  }
  return results;
}

export interface ComputerResolution {
  name?: string;
  status?: string;
}

export type ComputerResolver = (name: string, config: Config) => Promise<ComputerResolution>;

export async function checkComputer(config: Config, resolver?: ComputerResolver): Promise<CheckResult> {
  if (!config.LETTA_COMPUTER) return result("PASS", "Letta computer", "using SDK-managed Cloud sandboxes", "No action needed.");
  if (!resolver) {
    return result("WARN", "Letta computer", `${config.LETTA_COMPUTER} was not verified`, "Verify this computer exists and is online in Letta Code.");
  }
  try {
    const computer = await resolver(config.LETTA_COMPUTER, config);
    const status = safeName(computer.status, "status unknown");
    return status === "online"
      ? result("PASS", "Letta computer", `${safeName(computer.name, config.LETTA_COMPUTER)} is online`, "No action needed.")
      : result("WARN", "Letta computer", `${safeName(computer.name, config.LETTA_COMPUTER)} is ${status}`, "Bring the computer online before starting the bot.");
  } catch {
    return result("FAIL", "Letta computer", "configured computer could not be resolved", "Check LETTA_COMPUTER and confirm it is registered to this account.");
  }
}

export async function checkTranscription(fetchImpl: DoctorFetch, config: Config): Promise<CheckResult> {
  const provider = config.TRANSCRIBE_PROVIDER;
  if (provider === "none") return result("PASS", "Transcription", "disabled", "No action needed.");

  let url: string | undefined;
  let headers: Record<string, string> | undefined;
  if (provider === "openai") {
    url = `${(config.TRANSCRIBE_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/models`;
    headers = { Authorization: `Bearer ${config.TRANSCRIBE_API_KEY!}` };
  } else if (provider === "groq") {
    url = `${(config.TRANSCRIBE_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/+$/, "")}/models`;
    headers = { Authorization: `Bearer ${config.TRANSCRIBE_API_KEY!}` };
  } else if (provider === "deepgram") {
    url = `${(config.TRANSCRIBE_BASE_URL ?? "https://api.deepgram.com/v1").replace(/\/+$/, "")}/projects`;
    headers = { Authorization: `Token ${config.TRANSCRIBE_API_KEY!}` };
  } else {
    return result(
      "WARN",
      "Transcription",
      `${provider} credentials were not verified without uploading audio`,
      "Run the bot and test with a short audio attachment.",
    );
  }

  try {
    const response = await fetchImpl(url, { headers });
    if (response.ok) return result("PASS", "Transcription", `${provider} credentials accepted`, "No action needed.");
    return result(
      "FAIL",
      "Transcription",
      `${provider} credential check failed (HTTP ${response.status})`,
      "Check TRANSCRIBE_API_KEY and TRANSCRIBE_BASE_URL.",
    );
  } catch {
    return result("FAIL", "Transcription", `could not reach ${provider}`, "Check TRANSCRIBE_BASE_URL and network access.");
  }
}

function describeRule(entry: RoutingTable["routes"][number]): string {
  const [kind, value] = Object.entries(entry).find(([k]) => k !== "conversation" && k !== "policy") ?? ["rule", "?"];
  return `${kind}:${value}`;
}

/** APPROVAL_MODE=admins (the default) with no admins means every call that needs approval is denied. */
export function checkApprovers(config: Config): CheckResult {
  const noAdmins = config.DISCORD_ADMIN_USER_IDS.length === 0 && config.DISCORD_ADMIN_ROLE_IDS.length === 0;
  if (config.APPROVAL_MODE === "admins" && noAdmins) {
    return result(
      "WARN",
      "Approvals",
      `APPROVAL_MODE=admins with no admin users or roles: tool calls that PERMISSION_MODE=${config.PERMISSION_MODE} does not auto-allow are denied`,
      "Set DISCORD_ADMIN_USER_IDS or DISCORD_ADMIN_ROLE_IDS so someone can approve them, or choose another APPROVAL_MODE.",
    );
  }
  if (config.APPROVAL_MODE === "allow") {
    return result(
      "PASS",
      "Approvals",
      `APPROVAL_MODE=allow, PERMISSION_MODE=${config.PERMISSION_MODE}: tool calls run without asking`,
      "Use APPROVAL_MODE=admins or requester if untrusted users can reach the bot.",
    );
  }
  return result("PASS", "Approvals", `APPROVAL_MODE=${config.APPROVAL_MODE}`, "No action needed.");
}

export async function checkDataDir(dataDir: string): Promise<CheckResult> {
  const directory = resolve(dataDir);
  const path = join(directory, `.doctor-${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path, "doctor", { flag: "wx" });
    await rm(path);
    return result("PASS", "DATA_DIR", "directory is writable", "No action needed.");
  } catch {
    await rm(path, { force: true }).catch(() => {});
    return result("FAIL", "DATA_DIR", "directory is not writable", "Create DATA_DIR and grant the bot process write permission.");
  }
}

export interface DoctorOptions {
  fetch?: DoctorFetch;
  env?: Record<string, string | undefined>;
  computerResolver?: ComputerResolver;
}

function configFailure(error: unknown): CheckResult[] {
  const text = error instanceof Error ? error.message : "Invalid configuration";
  const issues = text
    .split("\n")
    .slice(1)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
  if (issues.length === 0) issues.push("configuration is invalid");
  return issues.map((issue) => result("FAIL", "Config", issue, "Correct this environment variable and run doctor again."));
}

function redactResults(results: CheckResult[], env: Record<string, string | undefined>): CheckResult[] {
  const secrets = Object.entries(env)
    .filter(([key, value]) => !!value && /(TOKEN|API_KEY|SECRET|PASSWORD)/i.test(key))
    .map(([, value]) => value!)
    .filter((value) => value.length > 0);
  const redact = (text: string) => secrets.reduce((current, secret) => current.split(secret).join("[REDACTED]"), text);
  return results.map((item) => ({ ...item, message: redact(item.message), hint: redact(item.hint), check: redact(item.check) }));
}

export async function runDoctor(options: DoctorOptions = {}): Promise<CheckResult[]> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (error) {
    return redactResults(configFailure(error), env);
  }

  const results: CheckResult[] = [result("PASS", "Config", "configuration is valid", "No action needed."), checkApprovers(config)];
  const token = await checkDiscordToken(fetchImpl, config.DISCORD_BOT_TOKEN);
  results.push(token.check);
  const application = await checkDiscordApplication(fetchImpl, config.DISCORD_BOT_TOKEN);
  results.push(...application.checks);
  results.push(...(await checkGuildMembership(fetchImpl, config.DISCORD_BOT_TOKEN, config.DISCORD_GUILD_IDS)));

  const channelIds = [...config.DISCORD_CHANNEL_IDS, ...config.DISCORD_OPEN_CHANNEL_IDS];
  if (channelIds.length === 0) {
    results.push(result("PASS", "Channel permissions", "no channel allowlist is configured", "Mention the bot in an accessible channel to start a conversation."));
  } else if (token.user?.id) {
    results.push(...(await checkChannelPermissions(fetchImpl, config.DISCORD_BOT_TOKEN, token.user.id, channelIds)));
  } else {
    for (const channelId of [...new Set(channelIds)]) {
      results.push(result("FAIL", `Channel ${channelId}`, "permissions could not be checked without a valid bot token", "Fix DISCORD_BOT_TOKEN and run doctor again."));
    }
  }

  const letta = await checkLetta(fetchImpl, config);
  results.push(letta);
  // A rejected API key makes every computer lookup fail too; say so instead of
  // blaming LETTA_COMPUTER.
  const lettaAuthFailed = letta.status === "FAIL" && letta.message.startsWith("authentication failed");
  results.push(
    lettaAuthFailed && config.LETTA_COMPUTER
      ? result("FAIL", "Letta computer", "could not be checked without a valid API key", "Fix LETTA_API_KEY and run doctor again.")
      : await checkComputer(config, options.computerResolver),
  );
  if (!lettaAuthFailed) results.push(...(await checkRoutingTable(fetchImpl, config)));
  results.push(await checkTranscription(fetchImpl, config));
  results.push(await checkDataDir(config.DATA_DIR));
  return redactResults(results, env);
}

export function formatCheck(check: CheckResult): string {
  return `${check.status} ${check.check}: ${check.message}. Hint: ${check.hint}`;
}

async function sdkComputerResolver(name: string, config: Config): Promise<ComputerResolution> {
  const client = new LettaAgentClient({
    backend: "cloud",
    apiKey: config.LETTA_API_KEY,
    ...(config.LETTA_BASE_URL ? { apiBaseUrl: config.LETTA_BASE_URL } : {}),
  });
  try {
    const resolved = await client.computers.resolve(name);
    return { name: resolved.computer?.name ?? name, status: resolved.computer?.status ?? "online" };
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  const checks = await runDoctor({ computerResolver: sdkComputerResolver });
  for (const check of checks) console.log(formatCheck(check));
  if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
}
