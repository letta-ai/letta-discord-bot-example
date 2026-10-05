# letta-discord-listener

A small Bun + TypeScript process that connects one Discord bot to one Letta agent through the
Letta Agent SDK (`backend: "cloud"`).

## What it is

This is a listener you run yourself, the alternative to letting Letta run Letta Code Channels:

- Every Discord thread or DM maps to its own Letta conversation, so every surface gets its own
  SDK-managed Cloud sandbox.
- The listener holds the Discord bot token. Sandboxes never see it, they only run the agent tools
  the SDK hands them.
- Turns are serialized per route, streamed back into Discord, and tool calls are gated by an
  approval policy you control through env vars.
- Nothing about the agent configuration (model, permission mode, toolset) can be changed from
  Discord. Only conversations and turns can.

## Quickstart

1. Create a Discord application at <https://discord.com/developers/applications> and add a bot.
2. On the **Bot** page enable the **Message Content** privileged gateway intent. Without it the
   listener receives empty message content.
3. Grab the bot token from the same page (**Reset Token** if you never copied it).
4. On the **OAuth2 > URL Generator** page, pick scopes `bot` and `applications.commands`, then
   enable exactly these permissions:
   `Send Messages`, `Send Messages in Threads`, `Create Public Threads`, `Read Message History`,
   `Add Reactions`, `Attach Files`, `Embed Links`.
   Generate the URL, open it, and install the bot into your guild.
5. Create an agent in Letta and note its `agent-...` id and your Letta API key.
6. Set up env:

   ```bash
   cp .env.example .env
   ```

   At minimum fill in `DISCORD_BOT_TOKEN`, `LETTA_API_KEY` and `LETTA_AGENT_ID`. Never commit the
   `.env` file.
7. Run it:

   ```bash
   npm ci && bun run start
   ```

   Dependencies install with npm (`package-lock.json`) because Bun 1.3.14's resolver crashes on
   this dependency graph. Bun is still the runtime; `bun run src/index.ts` runs the entrypoint directly.

### Checking your setup

Before starting the listener, run `bun run doctor`. It validates configuration, Discord access and
permissions, the Letta agent and computer, transcription credentials when they can be checked without
audio, and `DATA_DIR` write access. It does not connect to the Discord Gateway or post messages.

## Configuration

All configuration is env only, validated by `ConfigSchema` in `src/config.ts`. Defaults below are
what the process uses when a variable is absent. CSV means comma separated. An empty value is fine
for CSV, integer, boolean and free text keys, but the enum and URL keys must hold a valid value or
stay unset, since an empty string fails validation and the process refuses to start.

| Variable | Default | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | required | Discord bot token. |
| `LETTA_API_KEY` | required | Letta API key. |
| `LETTA_AGENT_ID` | required | Target agent id, must start with `agent-`. |
| `LETTA_BASE_URL` | unset | Letta API base URL, for self hosted Letta. |
| `LETTA_COMPUTER` | unset | Custom sandbox target. Unset means an SDK-managed Cloud sandbox per conversation. |
| `SANDBOX_TTL_MINUTES` | `30` | Idle lifetime of each conversation sandbox. |
| `PERMISSION_MODE` | `standard` | `strict`, `standard`, `acceptEdits` or `unrestricted`. |
| `ALLOWED_TOOLS` | empty (CSV) | Tool allowlist. Empty uses the harness default toolset. |
| `TOOLSET_BASE` | unset | `auto`, `default`, `codex`, `gemini` or `none`. |
| `CONVERSATION_MODEL` | unset | Model pinned when a conversation is created. |
| `APPROVAL_MODE` | `admins` | `deny`, `admins`, `requester` or `allow`. |
| `APPROVAL_TIMEOUT_SECONDS` | `300` | How long an approval stays clickable, then deny. |
| `TURN_TIMEOUT_SECONDS` | `900` | Longest a whole turn may run, approval waits included. Must exceed `APPROVAL_TIMEOUT_SECONDS`. The SDK's own default is 2 minutes. |
| `ENABLE_DISCORD_TOOLS` | `true` | Expose the listener-owned Discord tools to the agent. |
| `DISCORD_GUILD_IDS` | empty (CSV) | Guild allowlist, empty means any guild the bot is in. |
| `DISCORD_CHANNEL_IDS` | empty (CSV) | Channel allowlist, empty means any channel. |
| `DISCORD_OPEN_CHANNEL_IDS` | empty (CSV) | Channels where every message is answered without a mention. |
| `DISCORD_ALLOWED_USER_IDS` | empty (CSV) | Users allowed to DM the bot under `DM_POLICY=allowlist`. |
| `DISCORD_ADMIN_USER_IDS` | empty (CSV) | Users who count as admins for approvals and detailed `/status`. |
| `DISCORD_ADMIN_ROLE_IDS` | empty (CSV) | Roles that count as admins. |
| `DM_POLICY` | `allowlist` | `off`, `allowlist` or `open`. |
| `RESPOND_TO_BOTS` | `false` | Answer messages from other bots. |
| `AUTO_THREAD` | `true` | Create a public thread when mentioned in a normal channel. |
| `REGISTER_SLASH_COMMANDS` | `true` | Register `/new` `/cancel` `/status` `/help` on startup. |
| `STREAM_EDITS` | `false` | Post the reply once when the turn finishes. Set `true` to stream by editing one message as text arrives. |
| `STREAM_EDIT_INTERVAL_MS` | `1200` | Minimum gap between streaming edits. |
| `SHOW_TOOL_STATUS` | `true` | Show a single in-place tool status line. |
| `SHOW_REASONING` | `false` | Stream reasoning summaries as a separate message. |
| `LIFECYCLE_REACTIONS` | `false` | When on, react to the triggering message when a turn succeeds (✅), fails (❌) or is cancelled (⏹️). |
| `DEBOUNCE_MS` | `1500` | Merge messages arriving in this window into one turn. |
| `MAX_IMAGE_BYTES` | `5242880` | Largest inline image, 5 MiB. |
| `MAX_FILE_BYTES` | `26214400` | Largest uploaded file, 25 MiB. |
| `LOCAL_ATTACHMENT_DIR` | unset | When turns run on a named computer that shares this filesystem, save attachments here and give the agent local paths. |
| `TRANSCRIBE_PROVIDER` | `none` | Speech-to-text for voice messages and audio files: `openai`, `groq`, `mistral`, `together`, `deepgram`, `assemblyai`, `elevenlabs`, `gemini`, or `openai-compatible`. |
| `TRANSCRIBE_API_KEY` | unset | Provider API key. Required for every provider except `openai-compatible`. |
| `TRANSCRIBE_MODEL` | provider default | Override the model, see the table under Voice messages. |
| `TRANSCRIBE_BASE_URL` | provider default | Override the API base (proxies). Required for `openai-compatible`. |
| `TRANSCRIBE_LANGUAGE` | unset | Language hint such as `en`; otherwise the provider detects it. |
| `TRANSCRIBE_TIMEOUT_SECONDS` | `60` | Per-attachment transcription timeout. |
| `DATA_DIR` | `./data` | Directory holding the route to conversation index. Mount this. |
| `HEALTH_PORT` | `8080` | Port serving `GET /healthz`. |
| `SESSION_IDLE_MINUTES` | `15` | Close an idle Letta session. The conversation is kept. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

## How routing works

A route is one Discord surface: `(guild, channel, thread)`, or the DM channel.

- Mention the bot in a normal channel with `AUTO_THREAD=true`: a public thread is created from the
  triggering message and that thread becomes the route.
- Inside a thread the bot owns, no mention is needed. The thread is the route.
- In a channel listed in `DISCORD_OPEN_CHANNEL_IDS` the bot answers every message, the channel is
  the route.
- DMs route to the DM channel, subject to `DM_POLICY`.
- Messages from the bot itself are always ignored, and other bots unless `RESPOND_TO_BOTS=true`.

On the first message for a route the listener creates a Letta conversation, records
`route -> conversationId` in `bun:sqlite` under `DATA_DIR`, and resumes a session for it. That
conversation owns one Cloud sandbox. Only one turn per route runs at a time; messages that arrive
mid-turn are queued and merged into the next turn. `/new` drops the mapping so the next message
starts a fresh conversation (the old one stays in Letta).

## Approvals

`APPROVAL_MODE` decides who signs off on a tool call. A request shows the tool name and a compact
preview of its input, plus Approve and Deny buttons.

| Value | Behavior |
|---|---|
| `deny` | Everything is auto-denied with a reason. Useful for a read-only agent. |
| `admins` | Buttons, only ids in `DISCORD_ADMIN_USER_IDS` or `DISCORD_ADMIN_ROLE_IDS` may click. |
| `requester` | Buttons, the user who triggered the turn or an admin may click. |
| `allow` | Everything is auto-allowed. Pair with `PERMISSION_MODE=strict`. |

Anything not decided within `APPROVAL_TIMEOUT_SECONDS` is denied.

## Discord tools

With `ENABLE_DISCORD_TOOLS=true` the agent gets four tools that run in the listener process, not in
the sandbox:

| Tool | Purpose |
|---|---|
| `discord_react` | Add a reaction to a message in the route. |
| `discord_read_history` | Read recent messages from the route. |
| `discord_send_file` | Send a file from the sandbox to the route. |
| `discord_send_message` | Post an extra message to the route. |

## Slash commands

| Command | Effect |
|---|---|
| `/new` | Forget this route, next message starts a new conversation. |
| `/cancel` | Abort the running turn. |
| `/status` | Ephemeral status for the route. Ids and model are shown to admins only. |
| `/help` | Short usage reminder. |

There are deliberately no harness control commands. No `/model`, no `/reload`, no permission or
toolset changes, nothing that mutates agent configuration from Discord. Configuration is env only
and belongs to whoever deploys the listener.

## Files and images

Images at or below `MAX_IMAGE_BYTES` are inlined to the model as multimodal content. Anything else
is downloaded by the listener and uploaded into the conversation sandbox under `/root/downloads`
(or saved to `LOCAL_ATTACHMENT_DIR` when turns run on a named computer). The envelope lists each
local path together with the original Discord CDN url, which the agent can re-download from later. The agent can send files back to the route from
`/root/downloads` with `discord_send_file`. Replies longer than the Discord limit are split on
paragraph and line boundaries with code fences kept balanced across chunks.

## Voice messages

With `TRANSCRIBE_PROVIDER` set, Discord voice messages and audio attachments are transcribed by the
listener before the turn starts. The transcript goes into the envelope inside the attachment
element, so the agent reads the words without a tool call. The audio file is still attached. A
failed transcription never drops the message; the attachment carries `transcript_error` instead.

| Provider | Default model | Notes |
| --- | --- | --- |
| `groq` | `whisper-large-v3-turbo` | Fastest in testing, about 0.4 seconds for a 19-second clip. Accepts Ogg/Opus. |
| `deepgram` | `nova-3` | Accepts Ogg/Opus directly; detects language unless `TRANSCRIBE_LANGUAGE` is set. |
| `openai` | `gpt-4o-mini-transcribe` | Also `gpt-4o-transcribe`, `whisper-1`. All three accept Ogg/Opus. In testing it was the most accurate on product names, at about 2 seconds for a 19-second clip. |
| `elevenlabs` | `scribe_v2` | |
| `assemblyai` | `universal-3-5-pro` | Upload and poll; slower for short clips. |
| `mistral` | `voxtral-mini-latest` | |
| `together` | `openai/whisper-large-v3` | |
| `gemini` | `gemini-3.8-flash` | Prompted transcription; inline audio up to 20 MB. |
| `openai-compatible` | `whisper-1` | Self-hosted Whisper with `/v1/audio/transcriptions`, such as Speaches (`http://localhost:8000/v1`) or LocalAI (`http://localhost:8080/v1`). The native whisper.cpp server is not OpenAI-compatible. |

Voice messages cannot contain a mention, so they reach the agent in bot threads, DMs, and channels
listed in `DISCORD_OPEN_CHANNEL_IDS`, not as a fresh mention in a channel.

## Deploying

Run exactly one instance. A second process with the same bot token opens a second Gateway session
and duplicates replies. Keep `DATA_DIR` on persistent storage, allow about 30 seconds to stop, and
expose no public port; `GET /healthz` on `HEALTH_PORT` is for platform health checks.

[docs/deploying.md](docs/deploying.md) covers systemd (with a tested unit in `deploy/systemd/`),
Docker Compose (`deploy/compose.yaml`), Fly.io (`fly.toml.example`), Railway, and Render, and
explains why Modal is a poor fit.

## Comparison with Letta Code Channels

| | Letta Code Channels | This listener |
|---|---|---|
| Discord token | Held by Letta | Held by you, in the listener env |
| Sandbox per conversation | Yes, managed by Letta | Yes, SDK managed Cloud sandbox |
| Agent configuration | Changed from chat | Env only, operator owned |
| Commands | Harness commands included | `/new` `/cancel` `/status` `/help` only |
| Hosting | Letta runs it | You run and secure it |
| Approvals | Product default | `deny`, `admins`, `requester` or `allow` |
| Routing index | Letta internal | `bun:sqlite` under `DATA_DIR` |
| Scaling | Letta managed | You manage, one replica |

## Security notes

- The bot token lives only in the listener process env. Sandboxes and the agent never receive it,
  because all Discord access goes through the listener-owned tools.
- Everything from Discord reaches the agent wrapped in a `channel-notification` envelope with a
  preamble marking it as untrusted user content, not operator instructions.
- Keep `PERMISSION_MODE=standard` or stricter and `APPROVAL_MODE` at `admins` or `requester` unless
  you fully trust every allowed user. `APPROVAL_MODE=allow` plus `PERMISSION_MODE=unrestricted`
  hands remote shell execution to anyone who can message the bot.
- Prefer `DM_POLICY=allowlist` or `off`, and set `DISCORD_ALLOWED_USER_IDS` explicitly.
- Only invite the bot to the guilds it needs and grant only the seven permissions listed above.
- `.env` is gitignored. Pass secrets through your platform secret store, never a Dockerfile, a
  committed config, or a slash command.
- The `/app/data` volume contains route ids and conversation ids. Treat it as sensitive and keep it
  on private storage.

## Layout

See `ARCHITECTURE.md` for module ownership and the full behavior spec.