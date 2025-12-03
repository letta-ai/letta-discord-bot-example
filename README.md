<a href="https://docs.letta.com/">
  <img alt="Stateful AI agent Discord chatbot template built with Letta" src="/assets/discord_chatbot_header_2x.png">
  <h1 align="center">Letta Discord Bot Example</h1>
</a>

<p align="center">
  Deploy your own AI chatbot using <a href="https://docs.letta.com/">Letta</a> to create agents that can learn over time.
</p>

<div align="center">
|
  <a href="#-features">Features</a> ·
  <a href="#-whats-included">What's included</a> ·
  <a href="#%EF%B8%8F-quickstart">Quickstart</a> ·
  <a href="#-running-the-app-locally">Running the app locally</a> ·
  <a href="#advanced-features">Advanced Features</a>
|
</div>

<div align="center">
<h3>One-click deploy with Railway</h3>
<a href="https://railway.com/template/C__ceE?referralCode=kdR8zc"><img src="https://railway.com/button.svg" alt="Deploy on Railway"/></a></div>
</div>

### 

> [!NOTE]
> You must also have a Discord app to use this app. Follow these [instructions](#-create-your-discord-app-and-set-your-variables) to create your Discord app.

## 📺 Video overview (watch on YouTube)

[![AI agents + Discord! Make a Discord chatbot with long-term memory using Letta](https://img.youtube.com/vi/HDyCAV-xuMw/0.jpg)](https://www.youtube.com/watch?v=HDyCAV-xuMw)

## ✨ Features

- 🧠 [Letta](https://github.com/letta-ai/letta)

  - Formerly known as **MemGPT**, Letta is an open-source framework designed for building **stateful LLM applications**. Our Discord bot example showcases powerful core features of Letta.

- Discord Bot

  - Interacts with your Discord server to send and receive messages.
    
    <img width="400" alt="image" src="https://github.com/user-attachments/assets/a09ce294-6cec-477f-ac60-f4b52493af67" />
  - Interacts with you through Direct Messages (DMs) and send and receive messages.
    
    <img width="400" alt="image" src="https://github.com/user-attachments/assets/0eabe8fa-556b-436f-9fbc-496f198ef482" />




## 📦 What's included

- [Letta TypeScript SDK](https://github.com/letta-ai/letta-node)

  - The Letta TypeScript library provides convenient access to the Letta API.

- [Discord.js](https://discord.js.org/)

  - Discord.js is a Node.js library that allows you to interact with the [Discord API](https://discord.com/developers/docs/intro), making it easy to build bot applications.

- [Express JS](https://expressjs.com)

  - Express JS is a minimal and flexible web framework for Node.js. We use Express to create a web server that accepts HTTP requests and interacts with the **Letta server** to generate responses. Express is also used to interact with the **Discord API**.

- [TypeScript](https://www.typescriptlang.org)

  - TypeScript enhances our codebase with **static typing, improved maintainability, and better developer tooling**, reducing potential runtime errors.

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run in production mode
npm start

# Build TypeScript to JavaScript
npm run build
```

## Message Flow

1. Discord message received and filtered based on type and configuration
2. Conversation history fetched from channel (last N messages, configurable)
3. Message formatted with sender context and channel info, sent to Letta agent
4. Letta streams response chunks back
5. Response sent to Discord (auto-split if longer than 2000 characters)

---

# ⚡️ Quickstart

### 📋 What you need before starting

- [Node.js](https://nodejs.org/en/download/)
- [npm](https://www.npmjs.com/get-npm)
- [Docker](https://docs.docker.com/get-docker/)
- [Discord App](https://discord.com/developers/applications)
- [LocalTunnel](https://github.com/localtunnel/localtunnel)

# 🚀 Running the app locally

> [!NOTE]
> These are instructions for running the *Discord bot server* locally, which connects a Letta server to Discord.
> If you're using Letta Cloud, all you'll need is your Letta Cloud API key + the Discord bot server, but if you're self-hosting, you'll also need to set up a Letta server.

## 💻 Grab a Letta API key

Follow the [quickstart guide](https://docs.letta.com/quickstart) to get your own Letta Cloud API key.

You can run your own Letta server using [Letta Desktop](https://docs.letta.com/quickstart/desktop) or [Docker](https://docs.letta.com/quickstart/docker).
If you're self-hosting a server, the Letta server will run on `http://localhost:8283` by default (that will be your `LETTA_BASE_URL`).

## 👉 Set up app

1️⃣ Clone the repository and install dependencies:

```bash
# Clone the repository
git clone https://github.com/letta-ai/letta-discord-bot-example.git

# Navigate to the project directory
cd letta-discord-bot-example

# Install dependencies
npm install

# Set environment variables
cp .env.template .env
```

2️⃣ Update the `.env` file with your Letta variables


## 👾 Create your Discord app and set your variables

1️⃣ Create a new Discord application [here](https://discord.com/developers/applications).

<img width="475" alt="image" src="https://github.com/user-attachments/assets/b57ec05b-5381-43f4-afc4-824a84abdd55" />


2️⃣ Under `Settings` -> `General Information` of your Discord app, copy your Discord application's `Application ID` and `Public Key`, and paste them in your `.env` file.

<img width="1302" alt="image" src="https://github.com/user-attachments/assets/56e55a8e-6322-48a7-9b36-afbf538db359" />


3️⃣ Under `Settings` -> `Bot` of your Discord app, copy your Discord bot's `Token`, and paste it in your `.env` file.

<img width="1426" alt="image" src="https://github.com/user-attachments/assets/f3ba4098-c976-427c-8b3d-1811d93d2b71" />

4️⃣ Enable the Privileged Gateway Intents

<img width="1667" alt="image" src="https://github.com/user-attachments/assets/68978702-42d0-4630-9b83-56e3a7ce6e14" />

5️⃣ Under `Settings` -> `Installation`, under `Guild Install` set up `scopes` and `permissions`

<img width="1057" alt="image" src="https://github.com/user-attachments/assets/73921af7-7478-4b51-b388-ff30b9844d2f" />


6️⃣ Install Discord Bot on your server; copy and paste `Link` on your browser.

<img width="2130" alt="image" src="https://github.com/user-attachments/assets/c6e22db7-7bde-4d34-ab67-074ee5c048b0" />

### ⚙️ Environment variables

Environment variables can be controlled by setting them in your `.env` file or by setting them in your deployment environment.

#### Letta Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LETTA_API_KEY` | API key for Letta Cloud, or password if self-hosting with authentication | - |
| `LETTA_BASE_URL` | Base URL of your Letta server | `https://api.letta.com` |
| `LETTA_AGENT_ID` | ID of the Letta agent to use | Required |
| `LETTA_USE_SENDER_PREFIX` | Include sender context prefix on messages | `true` |

#### Message Context Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `LETTA_CONTEXT_MESSAGE_COUNT` | Number of recent messages to include as context (0 to disable) | `5` |
| `LETTA_THREAD_CONTEXT_ENABLED` | Fetch full thread context when in a thread | `true` |
| `LETTA_THREAD_MESSAGE_LIMIT` | Max messages to fetch from threads (0 for unlimited) | `50` |

#### Discord Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_ID` | Discord application ID | Required |
| `DISCORD_TOKEN` | Discord bot token | Required |
| `PUBLIC_KEY` | Discord application public key | Required |
| `DISCORD_CHANNEL_ID` | Only listen to messages in this channel | - |
| `DISCORD_RESPONSE_CHANNEL_ID` | Only respond in this channel (agent sees all) | - |

#### Response Behavior

| Variable | Description | Default |
|----------|-------------|---------|
| `RESPOND_TO_DMS` | Respond to direct messages | `true` |
| `RESPOND_TO_MENTIONS` | Respond to @mentions | `true` |
| `RESPOND_TO_BOTS` | Respond to other bots | `false` |
| `RESPOND_TO_GENERIC` | Respond to all channel messages | `false` |
| `SURFACE_ERRORS` | Show errors in Discord (vs logs only) | `false` |

#### Timer/Heartbeat Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_TIMER` | Enable periodic heartbeat events | `true` |
| `TIMER_INTERVAL_MINUTES` | Max interval for random timer | `15` |
| `FIRING_PROBABILITY` | Probability timer fires (0.0-1.0) | `0.1` |

> Note: Timer requires `DISCORD_CHANNEL_ID` to be set.

#### Message Batching

| Variable | Description | Default |
|----------|-------------|---------|
| `MESSAGE_BATCH_ENABLED` | Accumulate messages before sending to agent | `false` |
| `MESSAGE_BATCH_SIZE` | Max messages per batch | `10` |
| `MESSAGE_BATCH_TIMEOUT_MS` | Auto-drain timeout | `30000` |

#### App Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port to run the app on | `3001` |

### 👾 Create your Letta agent

You can connect an existing agent to Discord (by using its `LETTA_AGENT_ID`), or you can create a brand new agent specifically to use as a Discord bot.

If you create a new agent, we'd recommend adding some information (e.g. inside of the `human` or `persona` memory block) that explains how to interact with Discord. For example, placing the following text in `human`:
```
I can use this space in my core memory to take notes on the users that I am interacting with.
So far, all I know that is that I am connected to a Discord server.
I can see messages that other users send on this server, as long as they are directed at me (with a mention or a reply).
I should also remember that if I want to "at" a user, I need to use the <@discord-id> format in my message response.
This will render the user tag in a dynamic way on Discord, vs any other reference to a user (eg their username) will just result in plaintext.
```

Additionally, if you would like to give your chatbot/agent the ability to "ignore" (not reply) to certain messages, you can add a custom tool like this to your agent (for information on how to add a custom tool, see [our docs](https://docs.letta.com/guides/agents/tools#custom-tools)):
```python
def ignore():
    """
    Not every message warrants a reply (especially if the message isn't directed at you). Call this tool to ignore the message.
    """
    return
```

The ability for an agent to "ignore" messages can be crucial if you connect your agent to an active Discord channel with many participants, especially if you set `RESPOND_TO_GENERIC` to `true` (in which case the agent will "see" every single message in a channel, even messages not directed at the agent itself).

## 🚀 Run app

To run the app locally, simply do:
```bash
npm start
```

This will spin up the Discord bot service, which will listen for events on Discord, and when an event happens (e.g. a message is sent in a channel), it will send an appropriate message to the Letta server, check for a response from the Letta server, and potentially send back a reply message on Discord.

We have also prepared a one-click deploy option to easily deploy this repo on Railway.
Simply click the deploy link, enter your environment variables (including your Letta server address and Letta agent ID), and your Discord bot will be ready to go (and live 24/7):

<a href="https://railway.com/template/C__ceE?referralCode=kdR8zc"><img src="https://railway.com/button.svg" alt="Deploy on Railway"/></a>

---

## Advanced Features

### Message Types

The bot distinguishes between four message types, each with a different prefix format sent to the agent:

| Type | When it applies | Format |
|------|-----------------|--------|
| **DM** | Direct message to the bot | `[username (id=123) sent you a direct message] message` |
| **MENTION** | Message @mentions the bot | `[username (id=123) sent a message in #channel mentioning you] message` |
| **REPLY** | Reply to bot's previous message | `[username (id=123) replied to you in #channel] message` |
| **GENERIC** | Other channel messages | `[username (id=123) sent a message in #channel] message` |

This context helps the agent understand where messages come from and respond appropriately.

### Conversation Context

The bot includes recent message history as context for the agent:

**Regular channels:**
- Fetches the last N messages (configured via `LETTA_CONTEXT_MESSAGE_COUNT`)
- Includes both user and bot messages
- Filters out command messages (starting with `!`)
- Format:
  ```
  [Recent conversation context:]
  - username1: message text
  - username2: message text
  [End context]

  [Current message from username]
  ```

**Threads:**
- Automatically detects thread messages
- Fetches thread starter and all replies (up to `LETTA_THREAD_MESSAGE_LIMIT`)
- Format:
  ```
  [Thread: "Thread name"]
  [Thread started by username: "original message"]

  [Thread conversation history:]
  - user1: message
  - user2: reply
  [End thread context]

  [Current message from user]
  ```

Thread context takes precedence over regular conversation history when in a thread.

### Message Handling

**Auto-splitting:** Messages longer than Discord's 2000 character limit are automatically split into multiple messages.

**Code block preservation:** When splitting, the bot preserves markdown code blocks, ensuring they aren't broken across messages.

**Code block isolation:** Code blocks are sent as separate messages for easy copying.

### Message Batching

When enabled, messages are accumulated before sending to the agent:

- Each channel has its own message buffer
- Batch drains when reaching `MESSAGE_BATCH_SIZE` or `MESSAGE_BATCH_TIMEOUT_MS`
- Format:
  ```
  [Batch of 5 messages from #general]
  1. [username (id=123) mentioned you] message text
  2. [username2 (id=456)] another message
  ...
  ```

This reduces API calls and provides better conversation context for active channels.

### Timer/Heartbeat

When enabled, the bot sends periodic heartbeat events to the agent:

- Fires at random intervals between 1 minute and `TIMER_INTERVAL_MINUTES`
- Only fires based on `FIRING_PROBABILITY` (default 10%)
- Requires `DISCORD_CHANNEL_ID` to know where to send responses
- Allows the agent to initiate conversations or update memory autonomously
