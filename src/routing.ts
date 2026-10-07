import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  ApprovalModeSchema,
  PermissionModeSchema,
  ToolsetBaseSchema,
  type ApprovalMode,
  type Config,
  type PermissionMode,
  type ToolsetBase,
} from "./config.ts";
import type { RouteKey } from "./types.ts";

/**
 * Routing table: per-surface conversation and tool policy.
 *
 * Without a table every route (thread, open channel, DM) gets its own
 * conversation, created on first use, and the env tool settings apply
 * everywhere. A table lets an operator:
 * - pin chosen surfaces to a conversation that already exists, such as the
 *   agent's default conversation (several surfaces may share one), and
 * - give chosen surfaces a different tool policy, such as no shell in a public
 *   channel while admins keep it in DMs.
 */

const Target = z
  .string()
  .min(1)
  .refine((v) => v === "auto" || v === "default" || /^(local-)?conv-/.test(v), {
    message: 'must be a conversation id (conv-...), "default", or "auto"',
  });

const id = z.string().regex(/^\d+$/, "must be a Discord snowflake id");

/** Overrides for the env tool settings. Omitted fields inherit. */
const PolicySchema = z
  .object({
    /** Exact client-tool allowlist (ALLOWED_TOOLS). Empty = the toolset's defaults. */
    allowedTools: z.array(z.string().min(1)).optional(),
    /** Built-in toolset preset (TOOLSET_BASE). "none" = no built-in client tools. */
    toolset: ToolsetBaseSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    approvalMode: ApprovalModeSchema.optional(),
  })
  .strict();

const fields = { conversation: Target.optional(), policy: PolicySchema.optional() };
const Entry = z
  .union([
    z.object({ thread: id, ...fields }).strict(),
    z.object({ channel: id, ...fields }).strict(),
    z.object({ dm: id, ...fields }).strict(),
    z.object({ guild: id, ...fields }).strict(),
  ])
  .refine((e) => e.conversation !== undefined || e.policy !== undefined, {
    message: "needs a conversation, a policy, or both",
  });

export const RoutingTableSchema = z
  .object({
    routes: z.array(Entry).default([]),
    /** Target for routes no entry pins. Omitted = "auto". */
    fallback: Target.optional(),
    /** Policy for every route, under any entry's policy and over the env settings. */
    policy: PolicySchema.optional(),
  })
  .strict()
  .superRefine((table, ctx) => {
    const seen = new Set<string>();
    table.routes.forEach((entry, i) => {
      const [kind, value] = selector(entry);
      const key = `${kind}:${value}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["routes", i], message: `duplicate ${kind} ${value}` });
      seen.add(key);
    });
  });

export type RoutingTable = z.infer<typeof RoutingTableSchema>;
type RouteEntry = RoutingTable["routes"][number];
type SelectorKind = "thread" | "channel" | "dm" | "guild";

function selector(entry: RouteEntry): [SelectorKind, string] {
  if ("thread" in entry) return ["thread", entry.thread];
  if ("channel" in entry) return ["channel", entry.channel];
  if ("dm" in entry) return ["dm", entry.dm];
  return ["guild", entry.guild];
}

export type RouteTarget =
  | { kind: "auto" }
  /** `conversationId` is a conv- id or "default" (the agent's default conversation). */
  | { kind: "pinned"; conversationId: string; rule: string };

/** Entries that apply to a route, most specific first: thread, channel (also covers threads under it), DM user, guild. */
function matches(table: RoutingTable, route: RouteKey): RouteEntry[] {
  const find = (kind: SelectorKind, value: string | null | undefined) =>
    value ? table.routes.find((e) => selector(e)[0] === kind && selector(e)[1] === value) : undefined;
  return [
    find("thread", route.threadId),
    route.guildId !== null ? find("channel", route.channelId) : undefined,
    route.guildId === null ? find("dm", route.userId) : undefined,
    find("guild", route.guildId),
  ].filter((e): e is RouteEntry => e !== undefined);
}

/** The most specific entry that sets a conversation wins, then `fallback`, then "auto". */
export function resolveRoute(table: RoutingTable | null | undefined, route: RouteKey): RouteTarget {
  if (!table) return { kind: "auto" };
  const hit = matches(table, route).find((e) => e.conversation !== undefined);
  const conversation = hit?.conversation ?? table.fallback ?? "auto";
  if (conversation === "auto") return { kind: "auto" };
  const rule = hit ? selector(hit).join(":") : "fallback";
  return { kind: "pinned", conversationId: conversation, rule };
}

/** Tool settings for one route's session and approvals. */
export interface ToolPolicy {
  /** Empty = the toolset's defaults. */
  allowedTools: string[];
  toolset?: ToolsetBase;
  permissionMode: PermissionMode;
  approvalMode: ApprovalMode;
}

/**
 * Each field comes from the most specific matching entry that sets it, then
 * the table's top-level `policy`, then the env settings.
 */
export function policyFor(
  config: Pick<Config, "ALLOWED_TOOLS" | "TOOLSET_BASE" | "PERMISSION_MODE" | "APPROVAL_MODE">,
  table: RoutingTable | null | undefined,
  route: RouteKey,
): ToolPolicy {
  const layers = [
    ...(table ? matches(table, route).map((e) => e.policy) : []),
    table?.policy,
  ].filter((p): p is z.infer<typeof PolicySchema> => p !== undefined);
  const pick = <K extends keyof z.infer<typeof PolicySchema>>(k: K) => layers.find((p) => p[k] !== undefined)?.[k];
  const toolset = pick("toolset") ?? config.TOOLSET_BASE;
  return {
    allowedTools: pick("allowedTools") ?? config.ALLOWED_TOOLS,
    ...(toolset ? { toolset } : {}),
    permissionMode: pick("permissionMode") ?? config.PERMISSION_MODE,
    approvalMode: pick("approvalMode") ?? config.APPROVAL_MODE,
  };
}

/** Every pinned conversation id in the table (excluding "auto"). */
export function pinnedConversations(table: RoutingTable): string[] {
  const all = [...table.routes.map((e) => e.conversation), table.fallback];
  return [...new Set(all.filter((c): c is string => c !== undefined && c !== "auto"))];
}

export function parseRoutingTable(text: string, source = "routing table"): RoutingTable {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  const parsed = RoutingTableSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${source}:\n${issues}`);
  }
  return parsed.data;
}

export function loadRoutingTable(path: string | undefined): RoutingTable | null {
  if (!path) return null;
  return parseRoutingTable(readFileSync(path, "utf8"), path);
}
