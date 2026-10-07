<a href="https://docs.letta.com/">
  <img alt="A Letta agent chatting in Discord" src="/assets/discord_chatbot_header_2x.png">
  <h1 align="center">Letta Discord Bot</h1>
</a>

<p align="center">
  Put a <a href="https://docs.letta.com/">Letta</a> agent in your Discord server. It remembers people,
  learns over time, runs tools in its own sandbox, and answers in threads, DMs, and voice messages.
</p>

<div align="center">
|
  <a href="#-features">Features</a> ·
  <a href="#-whats-included">What's included</a> ·
  <a href="#%EF%B8%8F-quickstart">Quickstart</a> ·
  <a href="#%EF%B8%8F-configuration">Configuration</a> ·
  <a href="#-deploying">Deploying</a>
|
</div>

> [!NOTE]
> This is a rewrite on the [Letta Agent SDK](https://docs.letta.com/). The previous Express bot,
> with message batching, timer heartbeats, and per-user memory blocks, is preserved unchanged on the
> [`legacy`](https://github.com/letta-ai/letta-discord-bot-example/tree/legacy) branch.

## ✨ Features

- 🧠 **An agent that remembers.** The bot is a stateful Letta agent, not a stateless chat
  completion. It carries memory across every conversation, so it gets to know your server and
  the people in it.
- 🧵 **A conversation per thread.** Mention the bot and it opens a thread. By default, every thread
  and DM gets its own Letta conversation and SDK-managed Cloud sandbox, so parallel chats stay
  separate. Routes can also be pinned to existing conversations.
- 🛠️ **Real tools with operator controls.** The agent can run code, read files, and work in its
  sandbox. You can require Approve and Deny buttons and choose who may use them.
- ⚡ **Live progress.** A typing indicator runs while the agent works, replies can stream into
  Discord as they are written, and `SHOW_TOOL_CALLS=true` shows each tool call in between.
- 🎙️ **Voice messages.** Send a voice note and the bot transcribes it before the agent reads it,
  with nine providers to choose from, including OpenAI, Groq, Deepgram, and a self-hosted Whisper.
- 🖼️ **Images and files.** Images go straight to the model. Other files land in the sandbox for the
  agent to open, and it can send files back.
- 🔐 **Your token, your rules.** You run the bot, so the Discord token never leaves your process.
  Nothing in Discord can change the agent's model, permissions, or tools.
- 🩺 **A setup doctor.** `bun run doctor` checks every credential and permission before you go
  live, and tells you exactly what to fix.

## 📦 What's included

- [Letta Agent SDK](https://docs.letta.com/)

  - Runs the agent. It creates or resumes conversations, manages the execution backend, streams
    replies, and handles tool approvals.

- [discord.js](https://discord.js.org/)

  - Connects to the [Discord API](https://discord.com/developers/docs/intro) for messages,
    threads, buttons, and slash commands.

- [Bun](https://bun.sh/) and [TypeScript](https://www.typescriptlang.org)

  - Bun runs the bot and its test suite, and stores the thread-to-conversation index in
    `bun:sqlite`. TypeScript and [Zod](https://zod.dev) keep the code and config typed and
    validated.

- 🚀 Deploy recipes

  - A tested systemd unit, Docker Compose, Fly.io, Railway, and Render, all in
    [docs/deploying.md](docs/deploying.md).

## ⚡️ Quickstart

### 📋 What you need

- A [Letta](https://app.letta.com) account, an agent, and an API key.
- A Discord account with permission to add bots to a server.
- [Bun](https://bun.sh/) and [Node.js](https://nodejs.org/) (npm installs the dependencies).

### 👾 Create your Discord app

1. Create an application at <https://discord.com/developers/applications> and add a bot.
2. On the **Bot** page, enable the **Message Content** privileged gateway intent. Without it the
   bot receives empty messages.
3. Copy the bot token from the same page (**Reset Token** if you never copied it).
4. On **OAuth2 > URL Generator**, pick the `bot` and `applications.commands` scopes, then enable
   exactly these permissions:
   `View Channel`, `Send Messages`, `Send Messages in Threads`, `Create Public Threads`,
   `Read Message History`, `Add Reactions`, `Attach Files`, `Embed Links`.
   Open the generated URL and install the bot into your server.

### 🤖 Connect your Letta agent

Create an agent in [Letta](https://app.letta.com) and note its `agent-...` ID and your API key.

```bash
git clone https://github.com/letta-ai/letta-discord-bot-example.git
cd letta-discord-bot-example
cp .env.example .env
```

Fill in `DISCORD_BOT_TOKEN`, `LETTA_API_KEY`, and `LETTA_AGENT_ID`. Never commit `.env`.

> [!WARNING]
> **Security defaults:** `APPROVAL_MODE=allow` and `PERMISSION_MODE=unrestricted` run every tool
> call without asking. Anyone who can message the bot can direct shell execution. Restrict who can
> reach the bot and configure a stricter permission and approval policy before exposing it to
> untrusted users.

> [!IMPORTANT]
> **Managed sandboxes and API keys:** with `LETTA_COMPUTER` unset, tools run in an SDK-managed
> Cloud sandbox. Some API keys currently get `401 Unauthorized` when the SDK refreshes that sandbox
> ([LET-13714](https://linear.app/letta/issue/LET-13714)), so every turn fails. If yours does, run
> tools on a [connected computer](docs/deploying.md#execution-backends) with `LETTA_COMPUTER`.

See [Tools and permissions](docs/tools-and-permissions.md) when you need to remove a tool or narrow
what the agent can execute.

### 🩺 Check your setup

```bash
npm ci
bun run doctor
```

The doctor validates configuration, Discord access, the Letta agent, the execution target, routing,
transcription, and `DATA_DIR`. It does not connect to the Discord Gateway or post messages.

### 🚀 Run it

```bash
bun run start
```

Mention the bot in a channel and it opens a thread to chat in. Dependencies install with npm
(`package-lock.json`) because Bun 1.3.14's resolver crashes on this dependency graph. Bun is still
the runtime.

## ⚙️ Configuration

All configuration is env only, validated by `ConfigSchema` in `src/config.ts`. Defaults below are
what the process uses when a variable is absent. CSV means comma separated. An empty value is fine
for CSV, integer, boolean and free text keys, but the enum and URL keys must hold a valid value or
stay unset, since an empty string fails validation and the process refuses to start.

<details>
<summary>All environment variables</summary>

| Variable | Default | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | required | Discord bot token. |
| `LETTA_API_KEY` | required | Letta API key. |
| `LETTA_AGENT_ID` | required | Target agent id, must start with `agent-`. |
| `LETTA_BASE_URL` | unset | Letta API base URL, for self hosted Letta. |
| `LETTA_COMPUTER` | unset | Connected computer for tool execution. Unset means an SDK-managed Cloud sandbox per conversation. |
| `SANDBOX_TTL_MINUTES` | `30` | Idle lifetime of each managed conversation sandbox, clamped to 1-60 minutes. |
| `PERMISSION_MODE` | `unrestricted` | `strict`, `standard`, `acceptEdits` or `unrestricted` (bypass permission checks). |
| `ALLOWED_TOOLS` | empty (CSV) | Tool allowlist. Empty uses the harness default toolset. |
| `TOOLSET_BASE` | unset | `auto`, `default`, `codex`, `gemini` or `none`. |
| `CONVERSATION_MODEL` | unset | Model pinned when a conversation is created. |
| `ROUTES_FILE` | unset | JSON routing table that pins Discord surfaces to existing conversations, see Routing table. |
| `APPROVAL_MODE` | `allow` | `deny`, `admins`, `requester` or `allow`. |
| `APPROVAL_TIMEOUT_SECONDS` | `300` | How long an approval stays clickable, then deny. |
| `TURN_TIMEOUT_SECONDS` | `900` | Longest a whole turn may run, approval waits included. Must exceed `APPROVAL_TIMEOUT_SECONDS`. The SDK's own default is 2 minutes. |
| `ENABLE_DISCORD_TOOLS` | `true` | Expose the listener-owned Discord tools to the agent. Does not remove `discord_send_message` in tool-mode open channels. |
| `DISCORD_GUILD_IDS` | empty (CSV) | Guild allowlist, empty means any guild the bot is in. |
| `DISCORD_CHANNEL_IDS` | empty (CSV) | Channel allowlist, empty means any channel. |
| `DISCORD_OPEN_CHANNEL_IDS` | empty (CSV) | Channels where every message is answered without a mention. |
| `OPEN_CHANNEL_REPLY_MODE` | `relay` | `relay` posts every reply in open channels. `tool` lets the agent stay silent there, see Open channels. |
| `DISCORD_ALLOWED_USER_IDS` | empty (CSV) | User allowlist. In servers, empty means everyone; once set, only these users and admins are answered. Also the DM allowlist under `DM_POLICY=allowlist`, where empty means admins only. |
| `DISCORD_ADMIN_USER_IDS` | empty (CSV) | Users who count as admins for approvals and detailed `/status`. |
| `DISCORD_ADMIN_ROLE_IDS` | empty (CSV) | Roles that count as admins. |
| `DM_POLICY` | `allowlist` | `off`, `allowlist` or `open`. |
| `RESPOND_TO_BOTS` | `false` | Accept another bot only when it mentions or replies to this bot. |
| `AUTO_THREAD` | `true` | Create a public thread when mentioned in a normal channel. |
| `REGISTER_SLASH_COMMANDS` | `true` | Register `/new` `/cancel` `/status` `/help` on startup. |
| `STREAM_EDITS` | `false` | Post the reply once when the turn finishes. Set `true` to stream by editing one message as text arrives. |
| `STREAM_EDIT_INTERVAL_MS` | `1200` | Minimum gap between streaming edits. |
| `SHOW_TOOL_CALLS` | `false` | Post tool calls as compact cards interleaved with the reply text, each line marked running, done or failed with its duration. |
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

</details>

## 🧭 How routing works

A route is one Discord surface: `(guild, channel, thread)`, or the DM channel.

- Mention the bot in a normal channel with `AUTO_THREAD=true`: a public thread is created from the
  triggering message and that thread becomes the route.
- Inside a thread the bot owns, no mention is needed. The thread is the route.
- In a channel listed in `DISCORD_OPEN_CHANNEL_IDS` the bot answers every message, the channel is
  the route.
- DMs route to the DM channel, subject to `DM_POLICY`.
- Messages from this bot are always ignored. Another bot is accepted only when
  `RESPOND_TO_BOTS=true` and it mentions or replies to this bot.

### Open channels

An open channel shows the agent every message, most of them not meant for it.
`OPEN_CHANNEL_REPLY_MODE` decides how it answers there and in threads under it:

- `relay` (default): like everywhere else, every reply the agent writes is posted.
- `tool`: plain text is not posted. The agent speaks only by calling `discord_send_message`,
  so it can read along and stay silent. There is no typing indicator, tool-call line, or
  lifecycle reaction, and `discord_send_message` never waits for approval. Failed turns
  still post an error. Unposted text is logged, which helps spot a model that forgets the tool.

Mentions in other channels, bot threads, and DMs always relay.

Relay is a live feed of the conversation: everything the agent says in it is posted, including
replies it sends on its own later, such as when a background task finishes. It works best when each
Discord thread or channel has its own conversation, which is the default. A conversation the agent
also uses elsewhere (a pinned route, or `default`) will post that activity here too. Output from
background subagents is not posted; the agent reports on it itself. In `tool` mode nothing is
posted unless the agent calls `discord_send_message`.

On the first message for an automatic route, the listener creates a Letta conversation, records
`route -> conversationId` in `bun:sqlite` under `DATA_DIR`, and resumes a session for it. By default,
that conversation gets an SDK-managed Cloud sandbox. With `LETTA_COMPUTER`, its tools run on the
connected computer instead. Only one turn per lane runs at a time; messages that arrive mid-turn
are queued and merged into the next turn. `/new` drops an automatic mapping so the next message
starts a fresh conversation. The old conversation stays in Letta.

### Routing table

To send Discord traffic into conversations that already exist (the agent's default conversation, or
one your other tools already use), point `ROUTES_FILE` at a JSON file like
[`routes.example.json`](routes.example.json):

```json
{
  "routes": [
    { "channel": "123456789012345678", "conversation": "conv-..." },
    { "thread": "223456789012345678", "conversation": "conv-..." },
    { "dm": "323456789012345678", "conversation": "default" },
    { "channel": "423456789012345678", "conversation": "auto" }
  ],
  "fallback": "auto"
}
```

- Each rule matches one `thread`, `channel` (including threads under it), `dm` (by user id), or
  `guild`. The most specific match wins, in that order, then `fallback`.
- `conversation` is a `conv-...` id, `default` for the agent's default conversation, or `auto` for
  the usual conversation per route. `auto` exempts a surface from a broader rule.
- Several surfaces may share a conversation. Their turns run one at a time, each message carries
  its channel and thread ids, and replies always go back where the message came from.
- A pinned conversation is never replaced. If Letta reports it missing, the turn fails with an error
  instead of starting a new one, and `/new` is disabled on pinned routes. `/status` shows the rule.
- A rule can also carry a `policy` that changes the tools and approvals on its surfaces, for
  example no shell in a public channel. See [Tools and permissions](docs/tools-and-permissions.md).
- Which messages the bot answers is still set by the gating options above. Model, memory, and
  schedules stay whatever the conversation and agent already have.

`bun run doctor` checks that the file parses and that every pinned conversation exists and belongs
to `LETTA_AGENT_ID`. The listener refuses to start with an invalid table. Combine with
`LETTA_COMPUTER` to keep execution on your own machine.

## ✅ Approvals

`APPROVAL_MODE` decides who signs off on a tool call. A routing-table `policy` can set a different
`approvalMode` per surface, see [Tools and permissions](docs/tools-and-permissions.md). A request shows the tool name and a compact
preview of its input, plus Approve and Deny buttons.

| Value | Behavior |
|---|---|
| `deny` | Everything is auto-denied with a reason. Useful for a read-only agent. |
| `admins` | Buttons, only ids in `DISCORD_ADMIN_USER_IDS` or `DISCORD_ADMIN_ROLE_IDS` may click. |
| `requester` | Buttons, the user who triggered the turn or an admin may click. |
| `allow` | Everything is auto-allowed. This is the default. |

Anything not decided within `APPROVAL_TIMEOUT_SECONDS` is denied.

`admins` needs at least one id in `DISCORD_ADMIN_USER_IDS` or `DISCORD_ADMIN_ROLE_IDS`. With
neither set nobody can click, so every request times out.
`bun run doctor` and the startup log both warn about this.

## 🔧 Discord tools

With `ENABLE_DISCORD_TOOLS=true` the agent gets these tools. They run in the listener process, not
in the sandbox:

| Tool | Purpose |
|---|---|
| `discord_react` | Add a reaction to a message in the route. |
| `discord_read_history` | Read recent messages from the route. |
| `discord_send_file` | Send a file from the sandbox to the route. |
| `discord_send_message` | Post a message. Only in open channels with `OPEN_CHANNEL_REPLY_MODE=tool`, where it is the only way to speak. |

To remove a tool or change which tools can run on a route, see
[Tools and permissions](docs/tools-and-permissions.md).

## 💬 Slash commands

| Command | Effect |
|---|---|
| `/new` | Forget this route, next message starts a new conversation. Disabled on pinned routes. |
| `/cancel` | Abort the running turn. |
| `/status` | Ephemeral status for the route. Ids and model are shown to admins only. |
| `/help` | Short usage reminder. |

`/new`, `/cancel` and `/status` follow the same gating as messages: the user, guild and channel
allowlists in servers, and `DM_POLICY` in DMs. Anyone else gets an ephemeral refusal.

There are deliberately no harness control commands. No `/model`, no `/reload`, no permission or
toolset changes, nothing that mutates agent configuration from Discord. Configuration is env only
and belongs to whoever deploys the listener.

## 🖼️ Files and images

Images at or below `MAX_IMAGE_BYTES` are inlined to the model as multimodal content. Anything else
is downloaded by the listener and uploaded into the conversation sandbox under `/root/downloads`
(or saved to `LOCAL_ATTACHMENT_DIR` when turns run on a named computer). The envelope lists each
local path together with the original Discord CDN url, which the agent can re-download from later. The agent can send files back to the route from
`/root/downloads` with `discord_send_file`. Replies longer than the Discord limit are split on
paragraph and line boundaries with code fences kept balanced across chunks.

## 🎙️ Voice messages

With `TRANSCRIBE_PROVIDER` set, Discord voice messages and audio attachments are transcribed by the
listener before the turn starts. The transcript goes into the envelope inside the attachment
element, so the agent reads the words without a tool call. The audio file is still attached. A
failed transcription never drops the message; the attachment carries `transcript_error` instead.

| Provider | Default model | Notes |
| --- | --- | --- |
| `groq` | `whisper-large-v3-turbo` | OpenAI-compatible transcription request. |
| `deepgram` | `nova-3` | Sends raw audio and detects language unless `TRANSCRIBE_LANGUAGE` is set. |
| `openai` | `gpt-4o-mini-transcribe` | OpenAI transcription request. |
| `elevenlabs` | `scribe_v2` | |
| `assemblyai` | `universal-3-5-pro` | Upload, create, and poll workflow. |
| `mistral` | `voxtral-mini-latest` | |
| `together` | `openai/whisper-large-v3` | |
| `gemini` | `gemini-3.8-flash` | Prompted transcription; inline audio up to 20 MB. |
| `openai-compatible` | `whisper-1` | Self-hosted Whisper with `/v1/audio/transcriptions`, such as Speaches (`http://localhost:8000/v1`) or LocalAI (`http://localhost:8080/v1`). The native whisper.cpp server is not OpenAI-compatible. |

Voice messages cannot contain a mention, so they reach the agent in bot threads, DMs, and channels
listed in `DISCORD_OPEN_CHANNEL_IDS`, not as a fresh mention in a channel.

## 🚀 Deploying

Run exactly one instance. A second process with the same bot token opens a second Gateway session
and duplicates replies. Keep `DATA_DIR` on persistent storage, allow about 30 seconds to stop, and
expose no public port; `GET /healthz` on `HEALTH_PORT` is for platform health checks.

[docs/deploying.md](docs/deploying.md) covers systemd (with a tested unit in `deploy/systemd/`),
Docker Compose (`deploy/compose.yaml`), Fly.io (`fly.toml.example`), Railway, and Render, and
explains why Modal is a poor fit.

## 🆚 Compared with Letta Code Channels

| | Letta Code Channels | This listener |
|---|---|---|
| Discord token | Held by Letta | Held by you, in the listener env |
| Execution environment | Managed by Letta | SDK-managed Cloud sandbox by default, or a connected computer |
| Agent configuration | Changed from chat | Env only, operator owned |
| Commands | Harness commands included | `/new` `/cancel` `/status` `/help` only |
| Hosting | Letta runs it | You run and secure it |
| Approvals | Product default | `deny`, `admins`, `requester` or `allow` |
| Routing index | Letta internal | `bun:sqlite` under `DATA_DIR` |
| Scaling | Letta managed | You manage, one replica |

## 🔐 Security notes

- The bot token lives only in the listener process env. Sandboxes and the agent never receive it,
  because all Discord access goes through the listener-owned tools.
- Everything from Discord reaches the agent wrapped in a `channel-notification` envelope with a
  preamble marking it as untrusted user content, not operator instructions.
- The defaults (`APPROVAL_MODE=allow`, `PERMISSION_MODE=unrestricted`) run every tool call without
  asking, on the sandbox or `LETTA_COMPUTER`. That hands shell execution to anyone who can message
  the bot. Unless you trust everyone who can reach it, remove the tools they should not have
  (`ALLOWED_TOOLS`, or a per-surface routing-table `policy`) and set `APPROVAL_MODE` to `admins` or
  `requester`. See [Tools and permissions](docs/tools-and-permissions.md).
- Prefer `DM_POLICY=allowlist` or `off`, and set `DISCORD_ALLOWED_USER_IDS` explicitly. The same
  list also restricts who the bot answers in servers, so include everyone who should be able to
  use it there.
- Only invite the bot to the guilds it needs and grant only the eight permissions listed above.
- `.env` is gitignored. Pass secrets through your platform secret store, never a Dockerfile, a
  committed config, or a slash command.
- The `/app/data` volume contains route ids and conversation ids. Treat it as sensitive and keep it
  on private storage.

## 🌐 Other platforms

The SDK bridge is separate from the Discord adapter. See [Putting a Letta agent on another
platform](docs/porting.md) for the reusable core, adapter contract, and a concrete Telegram mapping.

## 🗂️ Layout

Start with [AGENTS.md](AGENTS.md) for the file map and contributor invariants. Read
[ARCHITECTURE.md](ARCHITECTURE.md) for the current runtime design and [docs/porting.md](docs/porting.md)
for the platform boundary.

## 📄 License

MIT. See [LICENSE](LICENSE).
