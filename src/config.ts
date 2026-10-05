import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : /^(1|true|yes|on)$/i.test(v)));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int().nonnegative());

export const ConfigSchema = z.object({
  // Required credentials and target
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  LETTA_API_KEY: z.string().min(1, "LETTA_API_KEY is required"),
  LETTA_AGENT_ID: z.string().regex(/^agent-/, "LETTA_AGENT_ID must look like agent-..."),
  LETTA_BASE_URL: z.string().url().optional(),

  // Execution target. Empty = SDK-managed Cloud sandbox per conversation.
  LETTA_COMPUTER: z.string().optional(),
  SANDBOX_TTL_MINUTES: int(30),

  // Agent policy (operator-owned, never changeable from Discord)
  PERMISSION_MODE: z.enum(["strict", "standard", "acceptEdits", "unrestricted"]).default("standard"),
  ALLOWED_TOOLS: csv, // empty = harness default toolset
  TOOLSET_BASE: z.enum(["auto", "default", "codex", "gemini", "none"]).optional(),
  CONVERSATION_MODEL: z.string().optional(), // pinned at conversation create
  APPROVAL_MODE: z.enum(["deny", "admins", "requester", "allow"]).default("admins"),
  APPROVAL_TIMEOUT_SECONDS: int(300),
  ENABLE_DISCORD_TOOLS: bool(true),

  // Discord gating
  DISCORD_GUILD_IDS: csv, // empty = any guild the bot is in
  DISCORD_CHANNEL_IDS: csv, // empty = any channel
  DISCORD_OPEN_CHANNEL_IDS: csv, // respond to every message (no mention needed)
  DISCORD_ALLOWED_USER_IDS: csv, // empty = everyone
  DISCORD_ADMIN_USER_IDS: csv,
  DISCORD_ADMIN_ROLE_IDS: csv,
  DM_POLICY: z.enum(["off", "allowlist", "open"]).default("allowlist"),
  RESPOND_TO_BOTS: bool(false),
  AUTO_THREAD: bool(true),
  REGISTER_SLASH_COMMANDS: bool(true),

  // UX
  STREAM_EDITS: bool(false),
  STREAM_EDIT_INTERVAL_MS: int(1200),
  SHOW_TOOL_STATUS: bool(true),
  SHOW_REASONING: bool(false),
  LIFECYCLE_REACTIONS: bool(true),
  DEBOUNCE_MS: int(1500),
  MAX_IMAGE_BYTES: int(5 * 1024 * 1024),
  MAX_FILE_BYTES: int(25 * 1024 * 1024),

  // Runtime
  DATA_DIR: z.string().default("./data"),
  HEALTH_PORT: int(8080),
  SESSION_IDLE_MINUTES: int(15),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
