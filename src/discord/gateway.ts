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
import type { Config } from "../config.ts";
import type { RouteStore } from "../letta/store.ts";
import { log } from "../log.ts";
import { routeKeyString, type AgentBridge, type InboundMessage, type RouteKey, type TurnContext } from "../types.ts";
import { ApprovalManager } from "./approvals.ts";
import { handleCommand, registerSlashCommands } from "./commands.ts";
import { createTranscriber, type Transcriber } from "../transcribe/index.ts";
import { Debouncer, Deduper, gate, isAdminUser, normalize, threadName, type IngressMessage } from "./ingress.ts";

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

  function adminForMessage(m: Message): boolean {
    return isAdminUser(config, m.author.id, m.member?.roles.cache);
  }

  async function dispatch(route: RouteKey, items: Pending[]) {
    const last = items[items.length - 1]!;
    const renderer = new TurnRenderer({ config, channel: last.channel as never, triggerMessage: last.message as never });
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
      hasRoute: (r) => !!store.get(routeKeyString(r)),
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
    if (ch.isDMBased()) return { guildId: null, channelId: ch.id, threadId: null };
    if (ch.isThread()) return { guildId: i.guildId, channelId: ch.parentId ?? ch.id, threadId: ch.id };
    return { guildId: i.guildId, channelId: ch.id, threadId: null };
  }

  function adminForInteraction(i: Interaction): boolean {
    const roles = i.member && "cache" in (i.member.roles as object) ? (i.member.roles as { cache: { has(id: string): boolean } }).cache : undefined;
    return isAdminUser(config, i.user.id, roles);
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

  // Silence unused helper warning; kept for future per-message admin checks.
  void adminForMessage;

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
