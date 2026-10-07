import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Interaction,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import { replyModeFor, type Config } from "../config.ts";
import type { RouteStore } from "../letta/store.ts";
import { log } from "../log.ts";
import {
  routeKeyString,
  type AgentBridge,
  type InboundMessage,
  type RouteKey,
  type TurnContext,
  type TurnEvent,
} from "../types.ts";
import { ApprovalManager } from "./approvals.ts";
import { handleCommand, registerSlashCommands } from "./commands.ts";
import { createTranscriber, type Transcriber } from "../transcribe/index.ts";
import { Debouncer, Deduper, gate, isAdminUser, normalize, surfaceDenial, threadName, type IngressMessage } from "./ingress.ts";

/** Build the configured speech-to-text client, or undefined when disabled. */
export function transcriberFromConfig(config: Config): Transcriber | undefined {
  if (config.TRANSCRIBE_PROVIDER === "none") return undefined;
  return createTranscriber({
    provider: config.TRANSCRIBE_PROVIDER,
    apiKey: config.TRANSCRIBE_API_KEY,
    model: config.TRANSCRIBE_MODEL,
    baseUrl: config.TRANSCRIBE_BASE_URL,
    language: config.TRANSCRIBE_LANGUAGE,
    timeoutMs: config.TRANSCRIBE_TIMEOUT_SECONDS * 1000,
  });
}
import { TurnRenderer } from "./renderer.ts";

/** Stand-in trigger for posts that answer no message: nothing to reply to or react on. */
const NO_TRIGGER = {
  edit: async () => {},
  delete: async () => {},
  react: async () => {},
} as never;

export interface DiscordRuntime {
  client: Client;
  approvals: ApprovalManager;
  ready(): boolean;
  stop(): Promise<void>;
}

interface Pending {
  route: RouteKey;
  inbound: InboundMessage;
  message: Message;
  channel: TextBasedChannel;
}

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });
}

export async function startDiscord(
  config: Config,
  bridge: AgentBridge,
  store: RouteStore,
  client: Client = createDiscordClient(),
): Promise<DiscordRuntime> {
  const approvals = new ApprovalManager({ config });
  const transcriber = transcriberFromConfig(config);
  if (transcriber) log.info("voice transcription enabled", { provider: transcriber.provider, model: transcriber.model });
  const dedupe = new Deduper();
  let isReady = false;
  let stopping = false;

  // Each item carries its own route: with DEBOUNCE_MS=0 the flush runs inside push().
  const debouncer = new Debouncer<Pending>(config.DEBOUNCE_MS, (_key, items) => {
    const first = items[0];
    if (!first) return;
    void dispatch(first.route, items);
  });

  /**
   * Agent-initiated output (a task-notification run) has no Discord message to
   * answer, so it posts plainly into the route's thread or channel.
   */
  function backgroundRenderer(route: RouteKey): (e: TurnEvent) => void {
    const pending: TurnEvent[] = [];
    let renderer: TurnRenderer | null = null;
    let failed = false;
    client.channels
      .fetch(route.threadId ?? route.channelId)
      .then((channel) => {
        if (!channel?.isTextBased() || !("send" in channel)) throw new Error("not a text channel");
        renderer = new TurnRenderer({
          config,
          channel: channel as never,
          triggerMessage: NO_TRIGGER,
          replyMode: replyModeFor(config, route),
        });
        for (const e of pending.splice(0)) renderer.onEvent(e);
      })
      .catch((err) => {
        failed = true;
        log.warn("background post: channel unavailable", { route: routeKeyString(route), err: String(err) });
      });
    return (e) => {
      if (failed) return;
      if (renderer) renderer.onEvent(e);
      else pending.push(e);
    };
  }
  bridge.onBackground(backgroundRenderer);

  async function dispatch(route: RouteKey, items: Pending[]) {
    const last = items[items.length - 1]!;
    const renderer = new TurnRenderer({
      config,
      channel: last.channel as never,
      triggerMessage: last.message as never,
      replyMode: replyModeFor(config, route),
    });
    const ctx: TurnContext = {
      route,
      triggerMessageId: last.message.id,
      requesterId: last.message.author.id,
      onEvent: (e) => renderer.onEvent(e),
      requestApproval: (req) =>
        approvals.request(last.channel as never, req, (userId, roles) => isAdminUser(config, userId, roles)),
    };
    try {
      await bridge.submit(
        items.map((i) => i.inbound),
        ctx,
      );
      await renderer.finished;
    } catch (err) {
      log.error("dispatch failed", { route: routeKeyString(route), err: String(err) });
    }
  }

  async function onMessage(message: Message) {
    if (stopping || !client.user) return;
    if (!dedupe.firstTime(message.id)) return;
    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }
    // Ignore system messages (thread created, pins, joins).
    if (message.system) return;

    const decision = gate(config, message as unknown as IngressMessage, {
      botUserId: client.user.id,
      isBotThread: (id) => store.isBotThread(id),
      hasRoute: (r) => !!store.get(routeKeyString(r)) || !!store.pinnedLastActive(routeKeyString(r)),
    });
    if (!decision.accept) {
      log.debug("ignored message", { id: message.id, reason: decision.reason });
      return;
    }

    let route = decision.route;
    let channel = message.channel as TextBasedChannel;
    if (decision.needsThread && message.channel.type === ChannelType.GuildText) {
      try {
        const thread = await message.startThread({
          name: threadName(message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), ""), `Chat with ${client.user.username}`),
          autoArchiveDuration: 1440,
        });
        store.markBotThread(thread.id);
        route = { guildId: message.guildId, channelId: message.channel.id, threadId: thread.id };
        channel = thread;
      } catch (err) {
        log.warn("could not create thread; replying in channel", { err: String(err) });
      }
    }

    const inbound = await normalize(config, message as unknown as IngressMessage, route, client.user.id, undefined, transcriber);
    if (!inbound.text && inbound.images.length === 0 && inbound.files.length === 0) return;
    const pending: Pending = { route, inbound, message, channel };
    // A thread creation means a fresh route; no point debouncing the first message.
    if (decision.needsThread) void dispatch(route, [pending]);
    else debouncer.push(`${routeKeyString(route)}:${message.author.id}`, pending);
  }

  function routeForInteraction(i: Interaction): RouteKey | null {
    const ch = i.channel;
    if (!ch) return null;
    if (ch.isDMBased()) return { guildId: null, channelId: ch.id, threadId: null, userId: i.user.id };
    if (ch.isThread()) return { guildId: i.guildId, channelId: ch.parentId ?? ch.id, threadId: ch.id };
    return { guildId: i.guildId, channelId: ch.id, threadId: null };
  }

  function rolesForInteraction(i: Interaction): { has(id: string): boolean } | undefined {
    const roles = i.member?.roles;
    if (!roles) return undefined;
    if (Array.isArray(roles)) return { has: (id) => roles.includes(id) }; // APIInteractionGuildMember
    return roles.cache;
  }

  function adminForInteraction(i: Interaction): boolean {
    return isAdminUser(config, i.user.id, rolesForInteraction(i));
  }

  function mayUseInteraction(i: Interaction): boolean {
    const ch = i.channel;
    if (!ch) return false;
    const denial = surfaceDenial(config, {
      userId: i.user.id,
      roles: rolesForInteraction(i),
      guildId: i.guildId,
      channelId: ch.id,
      parentId: ch.isThread() ? ch.parentId : null,
      isDM: ch.isDMBased(),
    });
    if (denial) log.debug("ignored command", { user: i.user.id, reason: denial });
    return !denial;
  }

  client.on(Events.MessageCreate, (m) => {
    onMessage(m).catch((err) => log.error("message handler failed", { err: String(err) }));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        await approvals.handleInteraction(interaction as never);
        return;
      }
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction as never, {
          bridge,
          routeFor: (i: Interaction) => routeForInteraction(i),
          isAdmin: (i: Interaction) => adminForInteraction(i),
          mayUse: (i: Interaction) => mayUseInteraction(i),
        } as never);
      }
    } catch (err) {
      log.error("interaction failed", { err: String(err) });
    }
  });

  client.once(Events.ClientReady, async (c) => {
    isReady = true;
    log.info("discord ready", { user: c.user.tag, guilds: c.guilds.cache.size });
    if (config.REGISTER_SLASH_COMMANDS) {
      try {
        await registerSlashCommands(c as never, config);
        log.info("slash commands registered");
      } catch (err) {
        log.warn("slash command registration failed", { err: String(err) });
      }
    }
  });
  client.on(Events.ShardDisconnect, () => (isReady = false));
  client.on(Events.ShardResume, () => (isReady = true));
  client.on(Events.Error, (err) => log.error("discord client error", { err: String(err) }));

  await client.login(config.DISCORD_BOT_TOKEN);

  return {
    client,
    approvals,
    ready: () => isReady,
    async stop() {
      stopping = true;
      debouncer.flushAll();
      approvals.cancelAll();
      await client.destroy();
    },
  };
}
