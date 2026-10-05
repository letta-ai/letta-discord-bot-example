import type { Config } from "../config.ts";
import { log } from "../log.ts";
import type { InboundFile, InboundImage, InboundMessage, RouteKey } from "../types.ts";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Narrow view of a discord.js Message used by ingress (keeps tests simple). */
export interface IngressMessage {
  id: string;
  content: string;
  createdAt: Date;
  guildId: string | null;
  author: { id: string; bot: boolean; username: string; globalName?: string | null };
  member?: { displayName?: string; roles?: { cache: { has(id: string): boolean } } } | null;
  channel: {
    id: string;
    isThread(): boolean;
    isDMBased(): boolean;
    parentId?: string | null;
    ownerId?: string | null;
  };
  reference?: { messageId?: string } | null;
  mentions: { users: { has(id: string): boolean }; repliedUser?: { id: string } | null };
  attachments: { values(): Iterable<{ name: string; url: string; contentType: string | null; size: number }> };
}

export type GateDecision =
  | { accept: true; route: RouteKey; needsThread: boolean; mentioned: boolean }
  | { accept: false; reason: string };

export interface GateDeps {
  botUserId: string;
  isBotThread(threadId: string): boolean;
  hasRoute(route: RouteKey): boolean;
}

export function isAdminUser(config: Config, userId: string, roles?: { has(id: string): boolean }): boolean {
  if (config.DISCORD_ADMIN_USER_IDS.includes(userId)) return true;
  if (roles && config.DISCORD_ADMIN_ROLE_IDS.some((r) => roles.has(r))) return true;
  return false;
}

/** Pure gating: decide whether and where a message routes. */
export function gate(config: Config, msg: IngressMessage, deps: GateDeps): GateDecision {
  if (msg.author.id === deps.botUserId) return { accept: false, reason: "self" };
  const mentioned =
    msg.mentions.users.has(deps.botUserId) || msg.mentions.repliedUser?.id === deps.botUserId;
  if (msg.author.bot && !(config.RESPOND_TO_BOTS && mentioned)) return { accept: false, reason: "bot" };

  const admin = isAdminUser(config, msg.author.id, msg.member?.roles?.cache);
  const userAllowed =
    admin || config.DISCORD_ALLOWED_USER_IDS.length === 0 || config.DISCORD_ALLOWED_USER_IDS.includes(msg.author.id);

  // Direct messages
  if (msg.channel.isDMBased()) {
    if (config.DM_POLICY === "off") return { accept: false, reason: "dm-off" };
    if (config.DM_POLICY === "allowlist") {
      const listed = admin || config.DISCORD_ALLOWED_USER_IDS.includes(msg.author.id);
      if (!listed) return { accept: false, reason: "dm-not-allowlisted" };
    }
    return {
      accept: true,
      route: { guildId: null, channelId: msg.channel.id, threadId: null },
      needsThread: false,
      mentioned,
    };
  }

  if (!userAllowed) return { accept: false, reason: "user-not-allowed" };
  if (config.DISCORD_GUILD_IDS.length && !config.DISCORD_GUILD_IDS.includes(msg.guildId ?? ""))
    return { accept: false, reason: "guild-not-allowed" };

  const isThread = msg.channel.isThread();
  const parentId = isThread ? (msg.channel.parentId ?? msg.channel.id) : msg.channel.id;
  if (config.DISCORD_CHANNEL_IDS.length && !config.DISCORD_CHANNEL_IDS.includes(parentId) && !config.DISCORD_CHANNEL_IDS.includes(msg.channel.id))
    return { accept: false, reason: "channel-not-allowed" };

  const open = config.DISCORD_OPEN_CHANNEL_IDS.includes(parentId) || config.DISCORD_OPEN_CHANNEL_IDS.includes(msg.channel.id);

  if (isThread) {
    const route: RouteKey = { guildId: msg.guildId, channelId: parentId, threadId: msg.channel.id };
    const known = deps.isBotThread(msg.channel.id) || deps.hasRoute(route);
    if (!mentioned && !open && !known) return { accept: false, reason: "thread-not-addressed" };
    return { accept: true, route, needsThread: false, mentioned };
  }

  if (!mentioned && !open) return { accept: false, reason: "not-mentioned" };
  const needsThread = config.AUTO_THREAD;
  return {
    accept: true,
    route: { guildId: msg.guildId, channelId: msg.channel.id, threadId: null },
    needsThread,
    mentioned,
  };
}

/** Remove the bot's own mention and trim. */
export function stripMention(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").replace(/\s+\n/g, "\n").trim();
}

export function threadName(text: string, fallback: string): string {
  const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
  const clean = firstLine.replace(/<[@#&!:a-zA-Z0-9_]+>/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer>; headers?: { get(k: string): string | null } }>;

/** Download attachments: small images inline, other files as Blobs for sandbox upload. */
export async function collectAttachments(
  config: Config,
  msg: IngressMessage,
  fetcher: Fetcher = (u) => fetch(u),
): Promise<{ images: InboundImage[]; files: InboundFile[] }> {
  const images: InboundImage[] = [];
  const files: InboundFile[] = [];
  for (const a of msg.attachments.values()) {
    const type = (a.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    try {
      if (IMAGE_TYPES.has(type) && a.size <= config.MAX_IMAGE_BYTES) {
        const res = await fetcher(a.url);
        if (!res.ok) throw new Error("download failed");
        const buf = Buffer.from(await res.arrayBuffer());
        images.push({ name: a.name, mediaType: type as InboundImage["mediaType"], base64: buf.toString("base64") });
        continue;
      }
      const file: InboundFile = { name: a.name, url: a.url, contentType: a.contentType, size: a.size };
      if (a.size <= config.MAX_FILE_BYTES) {
        const res = await fetcher(a.url);
        if (res.ok) file.data = new Blob([await res.arrayBuffer()], { type: a.contentType ?? "application/octet-stream" });
      }
      files.push(file);
    } catch (err) {
      log.warn("attachment download failed", { name: a.name, err: String(err) });
      files.push({ name: a.name, url: a.url, contentType: a.contentType, size: a.size });
    }
  }
  return { images, files };
}

export async function normalize(
  config: Config,
  msg: IngressMessage,
  route: RouteKey,
  botUserId: string,
  fetcher?: Fetcher,
): Promise<InboundMessage> {
  const { images, files } = await collectAttachments(config, msg, fetcher);
  return {
    route,
    messageId: msg.id,
    authorId: msg.author.id,
    authorName: msg.member?.displayName || msg.author.globalName || msg.author.username,
    authorIsBot: msg.author.bot,
    text: stripMention(msg.content, botUserId),
    createdAt: msg.createdAt.toISOString(),
    ...(msg.reference?.messageId ? { replyToMessageId: msg.reference.messageId } : {}),
    images,
    files,
  };
}

/** Message-id dedupe with TTL. */
export class Deduper {
  private seen = new Map<string, number>();
  constructor(private ttlMs = 60_000) {}
  firstTime(id: string, now = Date.now()): boolean {
    for (const [k, t] of this.seen) if (now - t > this.ttlMs) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now);
    return true;
  }
}

/**
 * Per-route debounce: collect messages that arrive within `ms` of each other
 * (same route + author burst) and flush them as one batch.
 */
export class Debouncer<T> {
  private pending = new Map<string, { items: T[]; timer: ReturnType<typeof setTimeout> }>();
  constructor(
    private ms: number,
    private flush: (key: string, items: T[]) => void,
  ) {}
  push(key: string, item: T) {
    if (this.ms <= 0) {
      this.flush(key, [item]);
      return;
    }
    const p = this.pending.get(key);
    if (p) {
      clearTimeout(p.timer);
      p.items.push(item);
      p.timer = setTimeout(() => this.fire(key), this.ms);
    } else {
      this.pending.set(key, { items: [item], timer: setTimeout(() => this.fire(key), this.ms) });
    }
  }
  private fire(key: string) {
    const p = this.pending.get(key);
    if (!p) return;
    this.pending.delete(key);
    this.flush(key, p.items);
  }
  flushAll() {
    for (const key of [...this.pending.keys()]) {
      clearTimeout(this.pending.get(key)!.timer);
      this.fire(key);
    }
  }
}
