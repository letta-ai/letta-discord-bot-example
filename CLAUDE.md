# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Discord bot that connects Discord to Letta (formerly MemGPT), allowing users to interact with stateful AI agents through Discord channels and DMs. The bot uses the Letta TypeScript SDK to communicate with a Letta server and Discord.js to handle Discord interactions.

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

## Environment Setup

Copy `.env.template` to `.env` and configure:
- **Letta**: `LETTA_API_KEY`, `LETTA_BASE_URL`, `LETTA_AGENT_ID`
- **Letta Context**: `LETTA_USE_SENDER_PREFIX`, `LETTA_CONTEXT_MESSAGE_COUNT` (number of recent messages to include as context, default: 5, set to 0 to disable)
- **Discord**: `APP_ID`, `DISCORD_TOKEN`, `PUBLIC_KEY`
- **Channel filtering**:
  - `DISCORD_CHANNEL_ID`: Only listen to messages in this channel (ignores all other channels)
  - `DISCORD_RESPONSE_CHANNEL_ID`: Only respond in this channel (agent sees all messages but only replies here)
- **Behavior flags**: `RESPOND_TO_DMS`, `RESPOND_TO_MENTIONS`, `RESPOND_TO_BOTS`, `RESPOND_TO_GENERIC`
- **Timer settings**: `ENABLE_TIMER`, `TIMER_INTERVAL_MINUTES`, `FIRING_PROBABILITY`
- **Message batching**: `MESSAGE_BATCH_ENABLED`, `MESSAGE_BATCH_SIZE`, `MESSAGE_BATCH_TIMEOUT_MS`

## Architecture

### Core Files

- **src/server.ts**: Main Discord bot server
  - Sets up Express server and Discord client
  - Handles Discord events (`messageCreate`, `ready`)
  - Routes messages based on type (DM, mention, reply, generic)
  - Implements random timer feature that triggers agent heartbeats
  - Message routing logic determines whether to respond based on env flags

- **src/messages.ts**: Letta API integration
  - Handles streaming responses from Letta API
  - Processes different message types (assistant, reasoning, tool calls, tool returns)
  - Sends intermediate messages to Discord (reasoning and tool calls visible as separate messages)
  - Manages typing indicators during agent processing

### Message Flow

1. Discord message received → `server.ts` filters based on type and configuration
2. **Conversation history fetched** → Last N messages retrieved from channel (configurable via `LETTA_CONTEXT_MESSAGE_COUNT`)
3. Message formatted with sender context + channel name + conversation history → sent to Letta agent via `messages.ts`
4. Letta streams response chunks → processed and displayed in Discord
5. Stream includes:
   - **Reasoning messages**: Sent as separate Discord messages with "Reasoning" header
   - **Tool calls**: Sent as separate messages showing tool name and arguments
   - **Tool returns**: Sent showing return values (truncated to 200 chars)
   - **Assistant message**: Final response sent as reply

### Conversation History

The bot includes recent message history as context for the agent:
- Fetches the last N messages (default 5, configured via `LETTA_CONTEXT_MESSAGE_COUNT`)
- Includes both user and bot messages for full conversational context
- Filters out messages starting with `!` (command messages)
- Formatted as a context block prepended to the current message:
  ```
  [Recent conversation context:]
  - username1: message text
  - username2: message text
  - botname: response text
  [End context]

  [Current message from user]
  ```
- Works in both channels and DMs
- Set `LETTA_CONTEXT_MESSAGE_COUNT=0` to disable

### Message Types

The bot distinguishes between four message types and includes channel context in the message sent to the agent:
- **DM**: Direct messages to the bot
  - Format: `[username (id=123) sent you a direct message] message`
- **MENTION**: Messages that @mention the bot
  - Format: `[username (id=123) sent a message in #channel-name mentioning you] message`
- **REPLY**: Replies to bot's previous messages (includes truncated context)
  - Format: `[username (id=123) replied to you in #channel-name] message`
- **GENERIC**: Non-mention messages in channels (only if `RESPOND_TO_GENERIC=true`)
  - Format: `[username (id=123) sent a message in #channel-name] message`

### Response Channel Gating

The bot supports two types of channel filtering:
- **Listen filtering** (`DISCORD_CHANNEL_ID`): Bot only processes messages from this channel, ignoring all others
- **Response filtering** (`DISCORD_RESPONSE_CHANNEL_ID`): Bot processes messages from all channels (sends to agent) but only responds in this channel
  - Agent sees and learns from all conversations
  - Agent only sends visible responses in the specified channel
  - No typing indicators or intermediate messages shown outside response channel
  - Useful for having the agent observe multiple channels but only speak in one

### Message Batching

When enabled, the bot accumulates messages before sending to the agent:
- **Per-channel buffers**: Each channel has its own message batch
- **Drain conditions**: Batch drains when reaching `MESSAGE_BATCH_SIZE` messages OR `MESSAGE_BATCH_TIMEOUT_MS` timeout
- **Batch format**: All messages formatted as numbered list with user context
  ```
  [Batch of 5 messages from #general]
  1. [username (id=123) mentioned you] message text
  2. [username2 (id=456)] another message
  3. [username (id=123)] follow up
  ...
  ```
- **Benefits**: Reduces API calls, provides better conversation context, natural flow
- **Agent response**: Agent sees entire batch and can respond once to all messages

### Timer Feature

When enabled, the bot sends periodic heartbeat events to the agent:
- Random interval between 1 minute and `TIMER_INTERVAL_MINUTES`
- Fires based on `FIRING_PROBABILITY` (default 10%)
- Requires `DISCORD_CHANNEL_ID` to be set for message destination
- Allows agent to initiate conversations or update its memory autonomously

## TypeScript Configuration

- Target: ES2020
- Module: CommonJS
- Strict mode enabled
- Source files in `src/` directory

## Key Dependencies

- `@letta-ai/letta-client`: Letta TypeScript SDK for agent communication
- `discord.js`: Discord API library (v14+)
- `express`: Web server framework
- `dotenv`: Environment variable management
- `ts-node`: TypeScript execution for development
- `ts-node-dev`: Auto-reload during development
