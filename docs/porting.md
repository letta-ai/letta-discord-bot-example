# Putting a Letta agent on another platform

The repository separates SDK orchestration from Discord delivery. A Telegram, Slack, Matrix, or custom-chat adapter can reuse the conversation and run machinery while replacing the platform edge.

## Keep the core

Keep these parts unless the new platform requires a contract change:

- `src/letta/bridge.ts`: conversation creation, lane serialization, pooled sessions, file upload, retries, cancellation, and background output.
- `src/letta/run-tracker.ts`: attribution of streamed SDK messages to the submitted turn or an agent-initiated run.
- `src/letta/store.ts`: route-to-conversation persistence and last-active timestamps. Remove the `bot_threads` table only if it has no equivalent use.
- `src/letta/envelope.ts`: escaping, batch structure, attachment metadata, and multimodal messages. Rename the Discord source and platform-specific attributes, and preserve the explicit untrusted-content preamble.
- `src/types.ts`: `InboundMessage`, `TurnContext`, `TurnEvent`, and `AgentBridge` are the adapter contract. The current `RouteKey` and several comments use Discord names, so either translate into them or generalize them deliberately.
- `src/routing.ts`: keep automatic versus pinned conversations, specificity rules, and pinned-conversation safety. Change selector names and validation for the new route key.
- `src/config.ts`: keep SDK, conversation, session, and timeout settings. Replace Discord access and rendering settings.

The bridge remains responsible for exactly one stream reader per session. Do not move `session.stream()` into a renderer or create a second reader for notifications.

## Replace the platform adapter

Replace `src/discord/*` with equivalents for the target platform:

| Discord module | New adapter responsibility |
|---|---|
| `ingress.ts` | Authenticate updates, gate users and rooms, dedupe, debounce, fetch reply context, and produce `InboundMessage`. |
| `renderer.ts` and `split.ts` | Consume `TurnEvent`, show progress, render text and tool status, and enforce platform limits. |
| `approvals.ts` | Present an approval action, authorize the actor, resolve the callback, and expire stale controls. |
| `tools.ts` | Expose platform-owned actions such as sending messages, reactions, history, or files. |
| `commands.ts` | Map native commands to `AgentBridge.reset`, `cancel`, and `status`. |
| `gateway.ts` | Own the platform client, update loop or webhook, dispatch, shutdown, and `onBackground` registration. |

Also replace the Discord client construction in `src/index.ts`, Discord-specific doctor checks, environment names, and deployment credentials.

## Decisions every platform forces

### Route identity

Choose the smallest stable key that names one conversation surface. Include a thread or topic id only when it represents separate history. Decide whether direct chats are keyed by the room, user, account, or tenant. The serialized key must be stable because `RouteStore` uses it to recover conversation mappings after restart.

If the platform has no threads, use one route per room or direct chat. If several rooms intentionally share one Letta conversation, preserve the bridge's pinned-lane behavior so their turns serialize.

### Ingress and trust

Normalize platform payloads before calling the bridge. Keep the sender id, display name, source message id, timestamp, reply context, images, and downloadable files. Escape all platform text in the envelope and keep the preamble that identifies it as untrusted user content.

Updates can be redelivered. Dedupe by a platform update or message id, and make acknowledgement behavior explicit for webhooks or queues.

### Streaming and length limits

Choose between edit-based streaming and post-once delivery. If the API permits message edits, create one message for the first `assistant_delta`, then update it at a bounded interval. Otherwise buffer text until a message boundary or `done`. Split before the platform limit and preserve formatting across chunks.

### Approvals

Map `TurnContext.requestApproval` to a platform-native interaction. The request must identify the route and original requester, enforce the configured policy when a person clicks, and resolve exactly once. Disable or replace controls after approval, denial, timeout, cancellation, and shutdown. Inline keyboards, buttons, or interactive cards are transport, not authorization.

For how to remove a tool or constrain tool exposure, see [Tools and permissions](tools-and-permissions.md).

### Presence, files, and replies

Decide how long typing or presence indicators last and how often to refresh them. Map inbound files to blobs for managed-sandbox upload. Implement outbound upload as a listener-owned tool if the platform supports it. Keep the bot token inside the adapter process, never in the sandbox or tool input.

Preserve reply context when the platform exposes it. If replies can cross rooms or threads, reject or normalize those references before they reach a platform tool.

### Agent-initiated output

A Letta agent can speak between user turns, for example after a task notification. Register `AgentBridge.onBackground` once at startup. The callback receives a `RouteKey`, opens a renderer for that route, and consumes a burst of `TurnEvent` values ending in `done`. It has no triggering platform message, so it must post directly rather than reply.

Without this callback, user-triggered turns still work, but notifications and other agent-initiated replies have nowhere to go. The bridge intentionally does not post background subagent streams directly.

### One process per token

Run exactly one active update consumer for each bot token. A second Discord Gateway client duplicates replies. Other platforms have different failure modes, such as competing long-poll consumers or overlapping webhook deployments, but the operational rule is the same. Use one replica and stop the old process before the new one starts.

## Adapter shape

This sketch uses the real `AgentBridge` contract. It omits platform API details and error handling.

```ts
import type {
  AgentBridge,
  BackgroundSink,
  InboundMessage,
  RouteKey,
  TurnContext,
  TurnEvent,
} from "../src/types.ts";

interface PlatformRenderer {
  onEvent(event: TurnEvent): void;
  finished: Promise<void>;
}

function rendererFor(route: RouteKey, triggerMessageId?: string): PlatformRenderer {
  // Translate TurnEvent values into platform API calls.
  throw new Error("implement me");
}

export function connectPlatform(bridge: AgentBridge) {
  const background: BackgroundSink = (route) => {
    const renderer = rendererFor(route);
    return (event) => renderer.onEvent(event);
  };
  bridge.onBackground(background);

  return async function onInbound(inbound: InboundMessage) {
    const renderer = rendererFor(inbound.route, inbound.messageId);
    const ctx: TurnContext = {
      route: inbound.route,
      triggerMessageId: inbound.messageId,
      requesterId: inbound.authorId,
      onEvent: (event) => renderer.onEvent(event),
      requestApproval: (request) => requestPlatformApproval(request),
    };

    await bridge.submit([inbound], ctx);
    await renderer.finished;
  };
}
```

Use a per-route debouncer before `submit` if the platform commonly delivers message bursts. The bridge handles messages that arrive during a running turn, but it does not replace ingress dedupe.

## Concrete Telegram mapping

The mappings below use the official [Telegram Bot API](https://core.telegram.org/bots/api). Telegram supports mutually exclusive long polling with `getUpdates` or webhooks with `setWebhook`.

| Concern | Telegram mapping |
|---|---|
| Route | Use `(chat_id, message_thread_id)` as the stable surface. `message_thread_id` is optional and identifies a forum topic or message thread. Convert numeric ids to strings in `RouteKey`. |
| Ingress | Read `Update.message`, and dedupe with `update_id` or the pair `(chat.id, message_id)`. For long polling, advance `getUpdates.offset` past the highest processed update. |
| Approval | Send an `InlineKeyboardMarkup` with callback-data buttons. Receive the decision as `Update.callback_query`, authorize `CallbackQuery.from`, call `answerCallbackQuery`, then edit the approval message to remove or disable the controls. |
| Streaming | Send initial text with `sendMessage`, then update it with `editMessageText`. Rate-limit edits and fall back to additional messages after splitting. |
| Typing | Call `sendChatAction` with action `typing`. Telegram says the status lasts up to 5 seconds or until the bot sends a message, so refresh only while the turn is active. |
| Text limit | `sendMessage.text` accepts 1 to 4096 characters after entities are parsed. Split conservatively below 4096 and keep formatting valid per chunk. |
| Files | Use `getFile` to obtain inbound file paths, then download through the returned file URL. Send output with the appropriate method such as `sendDocument` or `sendPhoto`. |
| Background output | Save enough route information to call `sendMessage` with the same `chat_id` and optional `message_thread_id` from `AgentBridge.onBackground`. |

A direct Telegram translation can temporarily fit the current `RouteKey`:

```ts
const route: RouteKey = {
  guildId: message.chat.type === "private" ? null : String(message.chat.id),
  channelId: String(message.chat.id),
  threadId: message.message_thread_id ? String(message.message_thread_id) : null,
  userId: message.chat.type === "private" && message.from ? String(message.from.id) : undefined,
};
```

This compatibility mapping is practical for a first port, but the names are misleading. A maintained multi-platform core should replace `guildId`, `channelId`, and `threadId` with neutral route fields and update the routing schema, store keys, envelope attributes, and tests together.
