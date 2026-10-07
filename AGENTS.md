# Repository guide

This is a self-hosted Discord adapter for one Letta agent. It uses the Letta Agent SDK for conversations, sessions, tools, and event streams, then translates between those events and Discord.

## Source map

- `src/index.ts`: load config and routes, wire Discord to the bridge, start health checks, and shut down.
- `src/config.ts`: validate environment configuration and choose the reply mode for a route.
- `src/types.ts`: contract between the platform adapter and the Letta core.
- `src/routing.ts`: validate the optional routing table and resolve each route to a conversation and a tool policy.
- `src/log.ts`: structured JSON logging.
- `src/health.ts`: Bun server for `/` and `/healthz`.
- `src/doctor.ts`: preflight checks for config, Discord, Letta, routes, transcription, and storage.
- `src/transcribe/index.ts`: speech-to-text providers and audio helpers.
- `src/letta/bridge.ts`: conversation lanes, pooled sessions, turn queues, SDK stream pump, and background output.
- `src/letta/envelope.ts`: untrusted inbound envelope and multimodal SDK message.
- `src/letta/run-tracker.ts`: separate the active turn, agent-initiated runs, and background subagents.
- `src/letta/store.ts`: SQLite route index and bot-thread metadata.
- `src/discord/gateway.ts`: Discord client, event wiring, dispatch, and background rendering.
- `src/discord/ingress.ts`: access gates, normalization, attachment handling, dedupe, and debounce.
- `src/discord/renderer.ts`: turn events to typing, messages, tool cards, and final reactions.
- `src/discord/approvals.ts`: approval cards, button handling, authorization, and timeouts.
- `src/discord/tools.ts`: listener-owned Discord tools exposed to the agent.
- `src/discord/commands.ts`: register and handle `/new`, `/cancel`, `/status`, and `/help`.
- `src/discord/split.ts`: Discord-length text splitting with balanced code fences.

## Commands

```bash
npm ci                  # install dependencies
bun run start           # run the bot
bun run doctor          # validate a deployment
npm run typecheck       # TypeScript checks
bun test                # test suite
```

Never run `bun install`. Bun 1.3.14's resolver segfaults on this dependency graph. Use `npm ci` and the committed `package-lock.json`.

## Invariants

- Run exactly one process for each Discord bot token. Multiple Gateway clients duplicate replies.
- `src/letta/*` must not import `discord.js`.
- `src/types.ts` is the contract between the platform-neutral core and platform adapters.
- Keep platform API objects and tokens out of the Letta core and agent sandboxes.
- Preserve per-lane turn serialization and one stream reader per SDK session.
- Tests use the fake SDK and fake platform objects in `test/`. Tests must not use the network.

## Documentation

- `README.md`: setup, features, configuration, and operator guide.
- `ARCHITECTURE.md`: current runtime design and behavior.
- `docs/deploying.md`: production deployment recipes.
- `docs/porting.md`: adapting the core to another chat platform.
- `docs/tools-and-permissions.md`: tool exposure and permission policy.
