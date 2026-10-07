import { randomUUID } from "node:crypto";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import type { ApprovalDecision, ApprovalRequest } from "../types.ts";

/**
 * Tool-call approvals via Discord buttons. Policy comes from APPROVAL_MODE:
 * allow/deny short-circuit; admins/requester post Approve/Deny buttons and
 * wait (bounded by APPROVAL_TIMEOUT_SECONDS).
 */

type MentionType = "users" | "roles" | "everyone";
const NO_MENTIONS = { parse: [] as readonly MentionType[] };
const PREFIX = "lda:";
const PREVIEW_MAX = 800;
const EPHEMERAL = 64; // MessageFlags.Ephemeral

/** Raw Discord API component JSON (accepted by discord.js send/edit/update). */
export interface ApprovalComponentRow {
  type: 1;
  components: {
    type: 2;
    style: 3 | 4; // Success | Danger
    label: string;
    custom_id: string;
    disabled: boolean;
  }[];
}

/** Raw Discord API embed JSON (subset). */
export interface ApprovalEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

export interface ApprovalPayload {
  content: string;
  embeds?: ApprovalEmbed[];
  components: ApprovalComponentRow[];
  allowedMentions: { parse: readonly MentionType[] };
}

export interface ApprovalMessage {
  edit(options: ApprovalPayload): Promise<unknown>;
}

export interface ApprovalChannel {
  send(options: ApprovalPayload): Promise<ApprovalMessage>;
}

export type RolesLike = { has(id: string): boolean };
export type IsAdmin = (userId: string, roles?: RolesLike) => boolean;

/** Narrow view of a discord.js ButtonInteraction. */
export interface ApprovalInteraction {
  customId: string;
  user: { id: string };
  member?: { roles?: unknown } | null;
  reply(options: { content: string; flags: number; allowedMentions: ApprovalPayload["allowedMentions"] }): Promise<unknown>;
  update(options: ApprovalPayload): Promise<unknown>;
}

interface Pending {
  id: string;
  req: ApprovalRequest;
  isAdmin: IsAdmin;
  timeoutSeconds: number;
  mode: "admins" | "requester";
  message: ApprovalMessage | null;
  timer: ReturnType<typeof setTimeout> | null;
  terminal?: Verdict;
  resolve: (d: ApprovalDecision) => void;
}

export class ApprovalManager {
  private readonly config: Config;
  private readonly pending = new Map<string, Pending>();

  constructor(opts: { config: Config }) {
    this.config = opts.config;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  async request(channel: ApprovalChannel, req: ApprovalRequest, isAdmin: IsAdmin): Promise<ApprovalDecision> {
    const mode = req.approvalMode ?? this.config.APPROVAL_MODE;
    if (mode === "allow") return { allow: true };
    if (mode === "deny") {
      return { allow: false, message: `Tool ${req.toolName} requires approval, which is disabled for this Discord bot.` };
    }
    if (mode === "admins" && this.config.DISCORD_ADMIN_USER_IDS.length === 0 && this.config.DISCORD_ADMIN_ROLE_IDS.length === 0) {
      // Buttons nobody may click would only stall the turn until the timeout.
      return {
        allow: false,
        message: `Tool ${req.toolName} needs an admin's approval, and this Discord bot has no admins configured.`,
      };
    }

    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    const timeoutSeconds = this.config.APPROVAL_TIMEOUT_SECONDS;

    return new Promise<ApprovalDecision>((resolve) => {
      const p: Pending = { id, req, isAdmin, timeoutSeconds, mode, message: null, timer: null, resolve };
      this.pending.set(id, p);

      const timeoutMs = Math.max(0, this.config.APPROVAL_TIMEOUT_SECONDS * 1000);
      p.timer = setTimeout(() => void this.timeout(id), timeoutMs);
      (p.timer as { unref?: () => void }).unref?.();

      channel
        .send(payload(p, null, false))
        .then((msg) => {
          if (this.pending.has(id)) {
            p.message = msg;
          } else {
            // Settled (timeout/cancel) before the send returned: preserve the
            // terminal explanation while disabling the now-stale controls.
            msg.edit(payload(p, p.terminal ?? null, true)).catch(() => {});
          }
        })
        .catch((err) => {
          log.warn("approval message send failed", { tool: req.toolName, err: String(err) });
          this.settle(id, { allow: false, message: "Approval could not be requested in Discord." });
        });
    });
  }

  /** Returns true when the interaction belongs to this manager. */
  async handleInteraction(interaction: ApprovalInteraction): Promise<boolean> {
    const m = /^lda:(approve|deny):(.+)$/.exec(interaction.customId ?? "");
    if (!m) return false;
    const allow = m[1] === "approve";
    const id = m[2]!;
    const p = this.pending.get(id);
    const userId = interaction.user.id;

    try {
      if (!p) {
        await interaction.reply({ content: "This approval is no longer active.", flags: EPHEMERAL, allowedMentions: NO_MENTIONS });
        return true;
      }
      if (!this.mayDecide(p, userId, interaction.member)) {
        await interaction.reply({ content: "You can't approve this.", flags: EPHEMERAL, allowedMentions: NO_MENTIONS });
        return true;
      }
      const verdict: Verdict = allow ? { kind: "approved", by: userId } : { kind: "denied", by: userId };
      this.settle(id, {
        allow,
        decidedBy: userId,
        ...(allow ? {} : { message: `A Discord approver denied ${p.req.toolName}.` }),
      });
      await interaction.update(payload(p, verdict, true));
    } catch (err) {
      log.warn("approval interaction failed", { err: String(err) });
    }
    return true;
  }

  /** Deny every pending approval (shutdown). */
  async cancelAll(message = "Approval cancelled: the listener is shutting down."): Promise<void> {
    const all = [...this.pending.values()];
    await Promise.all(
      all.map(async (p) => {
        p.terminal = { kind: "cancelled" };
        this.settle(p.id, { allow: false, message });
        await p.message?.edit(payload(p, p.terminal, true)).catch(() => {});
      }),
    );
  }

  private mayDecide(p: Pending, userId: string, member: ApprovalInteraction["member"]): boolean {
    const roles = toRoles(member?.roles);
    let admin = false;
    try {
      admin = p.isAdmin(userId, roles);
    } catch {}
    if (admin) return true;
    return (p.req.approvalMode ?? this.config.APPROVAL_MODE) === "requester" && userId === p.req.requesterId;
  }

  private settle(id: string, decision: ApprovalDecision): Pending | null {
    const p = this.pending.get(id);
    if (!p) return null;
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    p.resolve(decision);
    return p;
  }

  private async timeout(id: string): Promise<void> {
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.terminal = { kind: "timed_out" };
    const p = this.settle(id, { allow: false, message: "Approval timed out" });
    if (!p?.message) return;
    await p.message
      .edit(payload(p, p.terminal!, true))
      .catch((err) => log.debug("approval timeout edit failed", { err: String(err) }));
  }
}

function buttons(id: string, disabled: boolean): ApprovalComponentRow[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Approve", custom_id: `${PREFIX}approve:${id}`, disabled },
        { type: 2, style: 4, label: "Deny", custom_id: `${PREFIX}deny:${id}`, disabled },
      ],
    },
  ];
}

function toRoles(roles: unknown): RolesLike | undefined {
  if (!roles) return undefined;
  if (Array.isArray(roles)) return { has: (id) => roles.includes(id) }; // APIInteractionGuildMember
  const cache = (roles as { cache?: unknown }).cache;
  if (cache && typeof (cache as RolesLike).has === "function") return cache as RolesLike; // GuildMemberRoleManager
  if (typeof (roles as RolesLike).has === "function") return roles as RolesLike;
  return undefined;
}

/** Neutralize backticks so user/agent content can't break out of a code block. */
function neutralize(s: string): string {
  return s.replace(/`/g, "`\u200b");
}

export function previewInput(input: Record<string, unknown>, max = PREVIEW_MAX): string {
  let json: string;
  try {
    json = JSON.stringify(input) ?? "{}";
  } catch {
    json = "[unserializable input]";
  }
  // Neutralize before applying the display bound: inserting zero-width spaces
  // must not allow an adversarial run of backticks to expand past the limit.
  json = neutralize(json);
  if (json.length > max) json = `${json.slice(0, Math.max(0, max - 1))}…`;
  return json;
}

type Verdict =
  | { kind: "approved"; by: string }
  | { kind: "denied"; by: string }
  | { kind: "timed_out" }
  | { kind: "cancelled" };

const COLORS = { pending: 0x5865f2, approved: 0x57f287, denied: 0xed4245, closed: 0x99aab5 } as const;
const CODE_KEYS = ["command", "cmd", "script", "code"] as const;
const MAX_FIELDS = 6;

function payload(p: Pending, verdict: Verdict | null, disabled: boolean): ApprovalPayload {
  return {
    content: "",
    embeds: [renderEmbed(p.req, p.mode, p.timeoutSeconds, verdict)],
    components: buttons(p.id, disabled),
    allowedMentions: NO_MENTIONS,
  };
}

/** Code-block language for a tool's main code argument. */
function codeLang(toolName: string, key: string): string {
  if (/bash|shell|terminal|exec/i.test(toolName) || key === "command" || key === "cmd") return "bash";
  if (/python/i.test(toolName)) return "py";
  return "";
}

function fieldValue(v: unknown): string {
  let raw: string;
  if (typeof v === "string") raw = v;
  else {
    try {
      raw = JSON.stringify(v) ?? String(v);
    } catch {
      raw = "[unserializable]";
    }
  }
  raw = neutralize(raw.replace(/\s+/g, " ").trim());
  if (raw.length > 200) raw = `${raw.slice(0, 199)}…`;
  return raw ? `\`${raw}\`` : "`(empty)`";
}

/**
 * Approval card: the call's description is the title, the main code argument
 * (e.g. Bash `command`) is a highlighted code block, remaining arguments are
 * compact fields, and tool + policy live in the footer.
 */
export function renderEmbed(
  req: ApprovalRequest,
  mode: "admins" | "requester",
  timeoutSeconds: number,
  verdict: Verdict | null,
): ApprovalEmbed {
  const input = req.toolInput ?? {};
  const tool = req.toolName.slice(0, 100);
  const desc = typeof input.description === "string" ? input.description.trim() : "";
  const codeKey = CODE_KEYS.find((k) => typeof input[k] === "string");

  const lines: string[] = [];
  if (codeKey) {
    let code = neutralize(String(input[codeKey]));
    if (code.length > PREVIEW_MAX * 2) code = `${code.slice(0, PREVIEW_MAX * 2 - 1)}…`;
    lines.push(`\`\`\`${codeLang(tool, codeKey)}\n${code}\n\`\`\``);
  }
  const rest = Object.entries(input).filter(([k]) => k !== codeKey && k !== "description");
  const fields = rest.slice(0, MAX_FIELDS).map(([k, v]) => ({ name: k.slice(0, 256), value: fieldValue(v), inline: true }));
  if (rest.length > MAX_FIELDS) lines.push(`-# +${rest.length - MAX_FIELDS} more argument(s)`);

  const who = mode === "admins" ? "An admin" : `<@${req.requesterId}> or an admin`;
  let color: number = COLORS.pending;
  if (!verdict) {
    lines.push(`${who} can approve or deny.`);
  } else if (verdict.kind === "approved") {
    color = COLORS.approved;
    lines.push(`**Approved by <@${verdict.by}>**`);
  } else if (verdict.kind === "denied") {
    color = COLORS.denied;
    lines.push(`**Denied by <@${verdict.by}>**`);
  } else {
    color = COLORS.closed;
    lines.push(verdict.kind === "timed_out" ? "**Approval timed out**" : "**Approval cancelled**");
  }

  const timeout = !verdict && timeoutSeconds > 0 ? ` · times out in ${formatDuration(timeoutSeconds)}` : "";
  const title = desc || `Run ${tool}`;
  return {
    title: title.length > 256 ? `${title.slice(0, 255)}…` : title,
    description: lines.join("\n\n").slice(0, 4000),
    color,
    ...(fields.length ? { fields } : {}),
    footer: { text: `Approval needed · ${tool}${timeout}` },
  };
}

function formatDuration(s: number): string {
  if (s % 60 === 0 && s >= 60) return `${s / 60} min`;
  return `${s}s`;
}
