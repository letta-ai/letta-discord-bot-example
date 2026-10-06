import type { Config } from "../config.ts";
import { log } from "../log.ts";
import { isAudioContentType, type TranscribeInput } from "../transcribe/index.ts";
import type { InboundFile, InboundImage, InboundMessage, RouteKey } from "../types.ts";

const VOICE_MESSAGE_FLAG = 1 << 13; // MessageFlags.IsVoiceMessage

/** Anything that can turn audio into text (see src/transcribe). */
export interface TranscriberLike {
  transcribe(input: TranscribeInput): Promise<{ text: string; provider?: string; model?: string }>;
}

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
  attachments: {
    values(): Iterable<{ name: string; url: string; contentType: string | null; size: number; duration?: number | null }>;
  };
  flags?: { has(bit: number): boolean };
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

/** Who is acting and where. Shared by message gating and slash commands. */
export interface Surface {
  userId: string;
  roles?: { has(id: string): boolean };
  guildId: string | null;
  channelId: string;
  /** Parent channel when the surface is a thread. */
  parentId?: string | null;
  isDM: boolean;
}

/**
 * Why this user may not use the bot on this surface, or null when they may.
 * Applies DM_POLICY in DMs, and the user, guild and channel allowlists in guilds.
 */
export function surfaceDenial(config: Config, s: Surface): string | null {
  const admin = isAdminUser(config, s.userId, s.roles);
  const listed = config.DISCORD_ALLOWED_USER_IDS.includes(s.userId);

  if (s.isDM) {
    if (config.DM_POLICY === "off") return "dm-off";
    if (config.DM_POLICY === "allowlist" && !admin && !listed) return "dm-not-allowlisted";
    return null;
  }

  if (!admin && config.DISCORD_ALLOWED_USER_IDS.length > 0 && !listed) return "user-not-allowed";
  if (config.DISCORD_GUILD_IDS.length && !config.DISCORD_GUILD_IDS.includes(s.guildId ?? "")) return "guild-not-allowed";
  const parentId = s.parentId ?? s.channelId;
  if (config.DISCORD_CHANNEL_IDS.length && !config.DISCORD_CHANNEL_IDS.includes(parentId) && !config.DISCORD_CHANNEL_IDS.includes(s.channelId))
    return "channel-not-allowed";
  return null;
}

/** Pure gating: decide whether and where a message routes. */
export function gate(config: Config, msg: IngressMessage, deps: GateDeps): GateDecision {
  if (msg.author.id === deps.botUserId) return { accept: false, reason: "self" };
  const mentioned =
    msg.mentions.users.has(deps.botUserId) || msg.mentions.repliedUser?.id === deps.botUserId;
  if (msg.author.bot && !(config.RESPOND_TO_BOTS && mentioned)) return { accept: false, reason: "bot" };

  const isDM = msg.channel.isDMBased();
  const isThread = !isDM && msg.channel.isThread();
  const parentId = isThread ? (msg.channel.parentId ?? msg.channel.id) : msg.channel.id;
  const denial = surfaceDenial(config, {
    userId: msg.author.id,
    roles: msg.member?.roles?.cache,
    guildId: msg.guildId,
    channelId: msg.channel.id,
    parentId,
    isDM,
  });
  if (denial) return { accept: false, reason: denial };

  // Direct messages
  if (isDM) {
    return {
      accept: true,
      route: { guildId: null, channelId: msg.channel.id, threadId: null },
      needsThread: false,
      mentioned,
    };
  }

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
  transcriber?: TranscriberLike,
): Promise<{ images: InboundImage[]; files: InboundFile[] }> {
  const isVoice = (() => {
    try {
      return !!msg.flags?.has(VOICE_MESSAGE_FLAG);
    } catch {
      return false;
    }
  })();
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
      const audio = isAudioContentType(a.contentType, a.name);
      if (isVoice && audio) file.voice = true;
      if (audio && typeof a.duration === "number") file.durationSecs = Math.round(a.duration * 10) / 10;
      if (a.size <= config.MAX_FILE_BYTES) {
        const res = await fetcher(a.url);
        if (res.ok) file.data = new Blob([await res.arrayBuffer()], { type: a.contentType ?? "application/octet-stream" });
      }
      if (audio && transcriber && file.data) {
        try {
          const out = await transcriber.transcribe({
            data: file.data,
            filename: a.name,
            contentType: a.contentType ?? "application/octet-stream",
          });
          file.transcript = out.text.trim();
          if (out.provider) file.transcriptProvider = out.provider;
          if (out.model) file.transcriptModel = out.model;
        } catch (err) {
          file.transcriptError = (err instanceof Error ? err.message : String(err)).slice(0, 200);
          log.warn("transcription failed", { name: a.name, err: file.transcriptError });
        }
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
  transcriber?: TranscriberLike,
): Promise<InboundMessage> {
  const { images, files } = await collectAttachments(config, msg, fetcher, transcriber);
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
