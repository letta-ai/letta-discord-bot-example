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
  <a href="#%EF%B8%8F-quickstart">Quickstart</a> ·
  <a href="#-tools-and-approvals">Tools</a> ·
  <a href="#%EF%B8%8F-configuration">Configuration</a> ·
  <a href="#-deploying">Deploying</a>
|
</div>

## ✨ Features

- 🧠 **An agent that remembers.** The bot is a stateful Letta agent, not a stateless chat
  completion. It carries memory across every conversation, so it gets to know your server and
  the people in it.
- 🧵 **A conversation per thread.** Mention the bot and it opens a thread. Every thread and DM gets
  its own conversation, so parallel chats stay separate while the agent's memory is shared.
- 🛠️ **Real tools, with you in charge.** The agent can run code and work with files in a Letta Cloud
  sandbox or on your own machine. Anything beyond reading waits for an admin to click Approve.
- ⚡ **Live progress.** A typing indicator runs while the agent works. Replies can stream into
  Discord as they are written, and tool calls can show up as they happen.
- 🎙️ **Voice messages.** Send a voice note and the bot transcribes it before the agent reads it,
  with nine providers to choose from, including OpenAI, Groq, Deepgram, and a self-hosted Whisper.
- 🖼️ **Images and files.** Images go straight to the model. Other files land in the sandbox for the
  agent to open, and it can send files back.
- 🔐 **Your token, your rules.** You run the bot, so the Discord token never leaves your process.
  Nothing in Discord can change the agent's model, permissions, or tools.
- 🩺 **A setup doctor.** `bun run doctor` checks every credential and permission before you go
  live, and tells you exactly what to fix.

## 🧩 How it works

```
Discord  <-->  this bot (you run it)  <-->  your Letta agent
                                              |
                                              +-- tools run in a Letta Cloud sandbox,
                                                  or on a computer you connect
```

The bot is a small [Bun](https://bun.sh/) process built on the
[Letta Agent SDK](https://docs.letta.com/agent-sdk/) and [discord.js](https://discord.js.org/). It
turns Discord messages into turns for your agent and posts the agent's replies back. The agent
itself, with its memory and model, lives in Letta, so you can talk to the same agent from Discord,
the Letta app, or anywhere else.

## ⚡️ Quickstart

### 📋 What you need

- A [Letta](https://app.letta.com) account, an agent, and an API key.
- A Discord account with permission to add bots to a server.
- [Bun](https://bun.sh/) and [Node.js](https://nodejs.org/).

### 👾 Create your Discord app

1. Create an application at <https://discord.com/developers/applications> and add a bot.
2. On the **Bot** page, enable the **Message Content** privileged gateway intent. If you cannot,
   set `DISCORD_MESSAGE_CONTENT_INTENT=false`: the bot then answers only @mentions, replies to
   it, and DMs.
3. Copy the bot token from the same page (**Reset Token** if you never copied it).
4. On **OAuth2 > URL Generator**, pick the `bot` and `applications.commands` scopes, then enable
   exactly these permissions:
   `View Channel`, `Send Messages`, `Send Messages in Threads`, `Create Public Threads`,
   `Read Message History`, `Add Reactions`, `Attach Files`, `Embed Links`.
   Open the generated URL and install the bot into your server.

### 🤖 Connect your agent

```bash
git clone https://github.com/letta-ai/letta-discord-bot-example.git
cd letta-discord-bot-example
cp .env.example .env
```

Fill in four values in `.env`:

| Variable | Where to find it |
|---|---|
| `DISCORD_BOT_TOKEN` | The token you copied from the **Bot** page. |
| `LETTA_API_KEY` | Your API key from [app.letta.com](https://app.letta.com). |
| `LETTA_AGENT_ID` | Your agent's ID, starting with `agent-`. |
| `DISCORD_ADMIN_USER_IDS` | Your own Discord user ID. Turn on **Developer Mode** under Discord's **Settings > Advanced**, then right-click your name and choose **Copy User ID**. |

You are now the bot's admin: you approve the agent's tool calls, and you can DM the bot. Never
commit `.env`.

### 🩺 Check your setup

```bash
npm ci
bun run doctor
```

The doctor checks your configuration, Discord access, the Letta agent, where tools will run, and
local storage, without posting anything to Discord. Dependencies install with npm; Bun runs the bot.

### 🚀 Say hello

```bash
bun run start
```

Mention the bot in any channel. It opens a thread, and everything you say in that thread goes to
your agent, no mention needed.

## 🛠 Tools and approvals

Out of the box the agent can read files, search, and run read-only commands on its own. Anything
else, like editing a file or running a script, posts an approval card in Discord, and only admins
can click **Approve**. Anything not decided within `APPROVAL_TIMEOUT_SECONDS` (five minutes) is
denied.

`APPROVAL_MODE` decides who approves:

| Value | Behavior |
|---|---|
| `admins` | Only `DISCORD_ADMIN_USER_IDS` or `DISCORD_ADMIN_ROLE_IDS` may approve. This is the default. With no admins set, those calls are denied. |
| `requester` | The person who asked, or an admin, may approve. |
| `deny` | Calls that need approval are always denied. |
| `allow` | Nothing waits for approval. |

`PERMISSION_MODE` decides which calls need approval in the first place. The default, `standard`,
asks about everything that is not read-only. `unrestricted` asks about nothing. Combined with
`APPROVAL_MODE=allow`, that gives anyone who can message the bot full use of the agent's shell, so
keep it for servers where you trust everyone.

You can also take tools away entirely, everywhere or per channel. For example, a public channel
can get an agent with no shell at all while your private channel keeps everything. See
[Tools and permissions](docs/tools-and-permissions.md).

The agent also gets a few Discord tools of its own, which run inside the bot rather than the
sandbox: `discord_react`, `discord_read_history`, and `discord_send_file` (send a file from the
sandbox to the chat). Turn them off with `ENABLE_DISCORD_TOOLS=false`.

## 💬 Where the bot listens

- **Mentions.** Mention the bot in a channel and it starts a public thread from your message.
- **Threads.** Inside a thread the bot started, it answers every message.
- **DMs.** By default only admins and `DISCORD_ALLOWED_USER_IDS` may DM the bot. Set `DM_POLICY`
  to `open` or `off` to change that.
- **Open channels.** In channels listed in `DISCORD_OPEN_CHANNEL_IDS`, the bot sees every message
  without a mention. With `OPEN_CHANNEL_REPLY_MODE=tool` it can also read along and stay quiet,
  speaking only when it calls `discord_send_message`.

Use `DISCORD_GUILD_IDS`, `DISCORD_CHANNEL_IDS`, and `DISCORD_ALLOWED_USER_IDS` to limit which
servers, channels, and people the bot answers. Messages from other bots are ignored unless
`RESPOND_TO_BOTS=true` and they mention or reply to this bot.

Each thread, open channel, and DM gets its own conversation with the agent, created on the first
message. `/new` starts a fresh one; the old conversation stays in Letta.

<details>
<summary>📌 Pinning Discord surfaces to existing conversations</summary>

To connect a channel to a conversation the agent already has, such as its default conversation or
one another app uses, point `ROUTES_FILE` at a JSON file like
[`routes.example.json`](routes.example.json):

```json
{
  "routes": [
    { "channel": "123456789012345678", "conversation": "conv-..." },
    { "dm": "323456789012345678", "conversation": "default" },
    { "channel": "523456789012345678", "policy": { "toolset": "none", "approvalMode": "deny" } }
  ],
  "fallback": "auto"
}
```

- A rule matches one `thread`, `channel` (including threads under it), `dm` (by user ID), or
  `guild`. The most specific match wins, then `fallback`.
- `conversation` is a `conv-...` ID, `default` for the agent's default conversation, or `auto` for
  the usual conversation per thread.
- Several surfaces can share one conversation. Replies always go back where the message came from.
- A pinned conversation is never replaced, and `/new` is disabled there.
- A `policy` changes the tools and approvals for that surface, see
  [Tools and permissions](docs/tools-and-permissions.md).

`bun run doctor` checks that every pinned conversation exists and belongs to your agent.

</details>

## ⌨️ Slash commands

| Command | Effect |
|---|---|
| `/new` | Start a fresh conversation here. |
| `/cancel` | Stop the agent's current turn. |
| `/status` | Show this conversation's status. Admins also see IDs and the model. |
| `/help` | A short usage reminder. |

There are no commands that change the agent's model, tools, or permissions. Those belong to whoever
runs the bot.

## 🎙️ Voice messages, images, and files

Set `TRANSCRIBE_PROVIDER` and `TRANSCRIBE_API_KEY`, and voice messages and audio files are
transcribed before the agent sees them. The agent reads the words directly and still gets the
audio file.

| Provider | Default model | Notes |
| --- | --- | --- |
| `groq` | `whisper-large-v3-turbo` | |
| `deepgram` | `nova-3` | |
| `openai` | `gpt-4o-mini-transcribe` | |
| `elevenlabs` | `scribe_v2` | |
| `assemblyai` | `universal-3-5-pro` | |
| `mistral` | `voxtral-mini-latest` | |
| `together` | `openai/whisper-large-v3` | |
| `gemini` | `gemini-3.8-flash` | Inline audio up to 20 MB. |
| `openai-compatible` | `whisper-1` | Self-hosted Whisper such as Speaches or LocalAI. Set `TRANSCRIBE_BASE_URL`. |

Voice messages cannot contain a mention, so send them in a bot thread, a DM, or an open channel.

Images up to 5 MiB go straight to the model. Other files up to 25 MiB are copied into the agent's
sandbox for it to open. Long replies are split across messages without breaking code blocks.

## ⚙️ Configuration

Everything is configured through environment variables. Only the four in the Quickstart are
needed; the rest have sensible defaults. `bun run doctor` validates all of them.

<details>
<summary>All environment variables</summary>

| Variable | Default | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | required | Discord bot token. |
| `LETTA_API_KEY` | required | Letta API key. |
| `LETTA_AGENT_ID` | required | Your agent's ID, starting with `agent-`. |
| `LETTA_BASE_URL` | unset | Letta API base URL, for a self-hosted Letta server. |
| `LETTA_COMPUTER` | unset | Run tools on this [connected computer](https://docs.letta.com/platform/computers/byom/). Unset means a Letta Cloud sandbox per conversation. |
| `SANDBOX_TTL_MINUTES` | `30` | How long an idle Cloud sandbox stays up, 1 to 60 minutes. |
| `PERMISSION_MODE` | `standard` | `strict`, `standard`, `acceptEdits` or `unrestricted`. See Tools and approvals. |
| `ALLOWED_TOOLS` | empty (CSV) | Only these tools are available. Empty means the default toolset. |
| `TOOLSET_BASE` | unset | `auto`, `default`, `codex`, `gemini` or `none`. |
| `CONVERSATION_MODEL` | unset | Model for newly created conversations. |
| `ROUTES_FILE` | unset | Routing table pinning surfaces to existing conversations. |
| `APPROVAL_MODE` | `admins` | `admins`, `requester`, `deny` or `allow`. |
| `APPROVAL_TIMEOUT_SECONDS` | `300` | How long an approval card stays clickable before the call is denied. |
| `TURN_TIMEOUT_SECONDS` | `900` | Longest a whole turn may run, approval waits included. Must exceed `APPROVAL_TIMEOUT_SECONDS`. |
| `ENABLE_DISCORD_TOOLS` | `true` | Give the agent the Discord tools listed above. |
| `DISCORD_GUILD_IDS` | empty (CSV) | Servers the bot answers in. Empty means all. |
| `DISCORD_CHANNEL_IDS` | empty (CSV) | Channels the bot answers in. Empty means all. |
| `DISCORD_OPEN_CHANNEL_IDS` | empty (CSV) | Channels where the bot sees every message without a mention. |
| `OPEN_CHANNEL_REPLY_MODE` | `relay` | `relay` posts every reply. `tool` lets the agent stay quiet in open channels. |
| `DISCORD_ALLOWED_USER_IDS` | empty (CSV) | People the bot answers. Empty means everyone in servers and only admins in DMs. |
| `DISCORD_ADMIN_USER_IDS` | empty (CSV) | Admins: they approve tool calls and see details in `/status`. |
| `DISCORD_ADMIN_ROLE_IDS` | empty (CSV) | Roles whose members count as admins. |
| `DM_POLICY` | `allowlist` | `off`, `allowlist` or `open`. |
| `RESPOND_TO_BOTS` | `false` | Answer other bots when they mention or reply to this bot. |
| `DISCORD_MESSAGE_CONTENT_INTENT` | `true` | Set `false` if the app lacks the Message Content intent. The bot then answers only mentions, replies to it, and DMs. |
| `AUTO_THREAD` | `true` | Start a thread when mentioned in a channel. |
| `REGISTER_SLASH_COMMANDS` | `true` | Register the slash commands on startup. |
| `STREAM_EDITS` | `false` | Stream replies by editing one message as text arrives. |
| `STREAM_EDIT_INTERVAL_MS` | `1200` | Minimum gap between streaming edits. |
| `SHOW_TOOL_CALLS` | `false` | Show each tool call in the chat as it runs. |
| `SHOW_REASONING` | `false` | Show the agent's reasoning summaries as a separate message. |
| `LIFECYCLE_REACTIONS` | `false` | React ✅, ❌ or ⏹️ to your message when a turn succeeds, fails, or is cancelled. |
| `DEBOUNCE_MS` | `1500` | Merge messages sent within this window into one turn. |
| `MAX_IMAGE_BYTES` | `5242880` | Largest image sent to the model, 5 MiB. |
| `MAX_FILE_BYTES` | `26214400` | Largest uploaded file, 25 MiB. |
| `LOCAL_ATTACHMENT_DIR` | unset | With `LETTA_COMPUTER` on the same machine, save attachments here instead of uploading them. |
| `TRANSCRIBE_PROVIDER` | `none` | Speech-to-text provider, see Voice messages. |
| `TRANSCRIBE_API_KEY` | unset | Provider API key. Not needed for `openai-compatible`. |
| `TRANSCRIBE_MODEL` | provider default | Override the transcription model. |
| `TRANSCRIBE_BASE_URL` | provider default | Override the provider's API URL. Required for `openai-compatible`. |
| `TRANSCRIBE_LANGUAGE` | unset | Language hint such as `en`. |
| `TRANSCRIBE_TIMEOUT_SECONDS` | `60` | Per-file transcription timeout. |
| `DATA_DIR` | `./data` | Where the bot stores which thread maps to which conversation. Keep it on persistent storage. |
| `HEALTH_PORT` | `8080` | Port for `GET /healthz`. |
| `SESSION_IDLE_MINUTES` | `15` | Close an idle connection to the agent. The conversation is kept. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

CSV values are comma separated. Leave a variable out rather than setting it to an empty string if
it takes a fixed set of values or a URL.

</details>

## 🚀 Deploying

Run exactly one copy of the bot per Discord token; a second copy answers every message twice. Keep
`DATA_DIR` on persistent storage. The bot needs no public port. `GET /healthz` on `HEALTH_PORT` is
there for your platform's health checks.

[docs/deploying.md](docs/deploying.md) has ready-made setups for systemd, Docker Compose, Fly.io,
Railway, and Render, and explains how to run the agent's tools on your own machine instead of a
Cloud sandbox.

## 🔐 Security

- The Discord token stays in the bot's process. The agent and its sandbox never see it.
- Messages from Discord reach the agent marked as untrusted user content, not instructions.
- Keep the default approvals unless you trust everyone who can message the bot, and remove tools
  that a public audience should never reach.
- Limit who can talk to the bot with `DISCORD_ALLOWED_USER_IDS` and `DM_POLICY`, invite it only to
  the servers it needs, and grant only the eight permissions above.
- Keep secrets in `.env` or your platform's secret store, never in a Dockerfile or committed file.

## 🔀 Letta's built-in Discord channel

Letta can also connect an agent to Discord directly with
[`letta channels`](https://docs.letta.com/self-hosting/channels/discord/), for agents running on
your own machine. Use this project when you want a Discord bot for a Letta Cloud agent, or a
codebase you can change and extend.

## 🧱 Build on it

The Discord code is separate from the part that talks to Letta, so the same core can serve another
chat platform. [Putting a Letta agent on another platform](docs/porting.md) walks through it with
Telegram as the example. [ARCHITECTURE.md](ARCHITECTURE.md) explains how the bot works inside, and
[AGENTS.md](AGENTS.md) is the guide for coding agents working in this repo.

## 📄 License

MIT. See [LICENSE](LICENSE).
