import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits, Message, OmitPartialGroupDMChannel, Partials } from 'discord.js';
import { sendMessage, sendTimerMessage, MessageType, splitMessage } from './messages';


const app = express();
const PORT = process.env.PORT || 3001;
const RESPOND_TO_DMS = process.env.RESPOND_TO_DMS === 'true';
const RESPOND_TO_MENTIONS = process.env.RESPOND_TO_MENTIONS === 'true';
const RESPOND_TO_BOTS = process.env.RESPOND_TO_BOTS === 'true';
const RESPOND_TO_GENERIC = process.env.RESPOND_TO_GENERIC === 'true';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;  // Optional: only listen in this channel
const RESPONSE_CHANNEL_ID = process.env.DISCORD_RESPONSE_CHANNEL_ID;  // Optional: only respond in this channel
const MESSAGE_REPLY_TRUNCATE_LENGTH = 100;  // how many chars to include
const ENABLE_TIMER = process.env.ENABLE_TIMER === 'true';
const TIMER_INTERVAL_MINUTES = parseInt(process.env.TIMER_INTERVAL_MINUTES || '15', 10);
const FIRING_PROBABILITY = parseFloat(process.env.FIRING_PROBABILITY || '0.1');
const MESSAGE_BATCH_ENABLED = process.env.MESSAGE_BATCH_ENABLED === 'true';
const MESSAGE_BATCH_SIZE = parseInt(process.env.MESSAGE_BATCH_SIZE || '10', 10);
const MESSAGE_BATCH_TIMEOUT_MS = parseInt(process.env.MESSAGE_BATCH_TIMEOUT_MS || '30000', 10);
const REPLY_IN_THREADS = process.env.REPLY_IN_THREADS === 'true';

function truncateMessage(message: string, maxLength: number): string {
    if (message.length > maxLength) {
        return message.substring(0, maxLength - 3) + '...'; // Truncate and add ellipsis
    }
    return message;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // Needed for commands and mentions
    GatewayIntentBits.GuildMessages, // Needed to read messages in servers
    GatewayIntentBits.MessageContent, // Required to read message content
    GatewayIntentBits.DirectMessages, // Needed to receive DMs
  ],
  partials: [Partials.Channel] // Required for handling DMs
});

client.on('error', (error) => {
  console.error('🛑 Discord client error:', error);
});

// Discord Bot Ready Event
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user?.tag}!`);
  if (MESSAGE_BATCH_ENABLED) {
    console.log(`📦 Message batching enabled: ${MESSAGE_BATCH_SIZE} messages or ${MESSAGE_BATCH_TIMEOUT_MS}ms timeout`);
  }
});

// Message batching infrastructure
interface BatchedMessage {
  message: OmitPartialGroupDMChannel<Message<boolean>>;
  messageType: MessageType;
  timestamp: number;
}

const channelMessageBuffers = new Map<string, BatchedMessage[]>();
const channelBatchTimers = new Map<string, NodeJS.Timeout>();

async function drainMessageBatch(channelId: string) {
  const buffer = channelMessageBuffers.get(channelId);
  const timer = channelBatchTimers.get(channelId);

  if (timer) {
    clearTimeout(timer);
    channelBatchTimers.delete(channelId);
  }

  if (!buffer || buffer.length === 0) {
    return;
  }

  console.log(`📦 Draining batch for channel ${channelId}: ${buffer.length} messages`);

  // Get the last message to use as the reply target
  const lastMessage = buffer[buffer.length - 1].message;
  const canRespond = shouldRespondInChannel(lastMessage);

  // Format all messages in batch
  const batchedContent = buffer.map((bm, idx) => {
    const { message, messageType } = bm;
    const username = message.author.username;
    const userId = message.author.id;
    const content = message.content;

    let prefix = '';
    if (messageType === MessageType.MENTION) {
      prefix = `[${username} (id=${userId}) mentioned you]`;
    } else if (messageType === MessageType.REPLY) {
      prefix = `[${username} (id=${userId}) replied to you]`;
    } else if (messageType === MessageType.DM) {
      prefix = `[${username} (id=${userId}) sent you a DM]`;
    } else {
      prefix = `[${username} (id=${userId})]`;
    }

    return `${idx + 1}. ${prefix} ${content}`;
  }).join('\n');

  const channelName = 'name' in lastMessage.channel && lastMessage.channel.name
    ? `#${lastMessage.channel.name}`
    : `channel ${channelId}`;

  const batchMessage = `[Batch of ${buffer.length} messages from ${channelName}]\n${batchedContent}`;

  console.log(`📦 Batch content:\n${batchMessage}`);

  try {
    // Send batch to agent using the last message as context
    const msg = await sendMessage(lastMessage, buffer[buffer.length - 1].messageType, canRespond, batchMessage);

    if (msg !== "" && canRespond) {
      await sendSplitReply(lastMessage, msg);
      console.log(`📦 Batch response sent (${msg.length} chars)`);
    } else if (msg !== "" && !canRespond) {
      console.log(`📦 Agent generated response but not responding (not in response channel): ${msg}`);
    }
  } catch (error) {
    console.error("🛑 Error processing batch:", error);
  }

  // Clear the buffer
  channelMessageBuffers.delete(channelId);
}

function addMessageToBatch(message: OmitPartialGroupDMChannel<Message<boolean>>, messageType: MessageType) {
  const channelId = message.channel.id;

  if (!channelMessageBuffers.has(channelId)) {
    channelMessageBuffers.set(channelId, []);
  }

  const buffer = channelMessageBuffers.get(channelId)!;
  buffer.push({
    message,
    messageType,
    timestamp: Date.now()
  });

  console.log(`📦 Added message to batch (${buffer.length}/${MESSAGE_BATCH_SIZE})`);

  // Check if we should drain due to size
  if (buffer.length >= MESSAGE_BATCH_SIZE) {
    console.log(`📦 Batch size limit reached, draining...`);
    drainMessageBatch(channelId);
    return;
  }

  // Set/reset the timeout
  if (channelBatchTimers.has(channelId)) {
    clearTimeout(channelBatchTimers.get(channelId)!);
  }

  const timeout = setTimeout(() => {
    console.log(`📦 Batch timeout reached, draining...`);
    drainMessageBatch(channelId);
  }, MESSAGE_BATCH_TIMEOUT_MS);

  channelBatchTimers.set(channelId, timeout);
}

// Helper function to check if bot should respond in this channel
function shouldRespondInChannel(message: OmitPartialGroupDMChannel<Message<boolean>>): boolean {
  // If RESPONSE_CHANNEL_ID is not set, respond everywhere
  if (!RESPONSE_CHANNEL_ID) {
    return true;
  }
  
  // For threads, check the parent channel ID
  const channelId = message.channel.isThread() 
    ? message.channel.parentId 
    : message.channel.id;
    
  // If RESPONSE_CHANNEL_ID is set, only respond in that channel
  return channelId === RESPONSE_CHANNEL_ID;
}

// Helper function to send a message, splitting if necessary
async function sendSplitReply(message: OmitPartialGroupDMChannel<Message<boolean>>, content: string) {
  const chunks = splitMessage(content);
  
  if (REPLY_IN_THREADS && message.guild !== null) {
    let thread;
    
    if (message.channel.isThread()) {
      thread = message.channel;
    } else if (message.hasThread && message.thread) {
      thread = message.thread;
    } else {
      const threadName = message.content.substring(0, 50) || 'Chat';
      thread = await message.startThread({ name: threadName });
    }
    
    if (thread) {
      for (const chunk of chunks) {
        await thread.send(chunk);
      }
    }
  } else {
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await message.reply(chunks[i]);
      } else {
        await message.channel.send(chunks[i]);
      }
    }
  }
}

// Helper function to send a message to a channel, splitting if necessary
async function sendSplitMessage(channel: { send: (content: string) => Promise<any> }, content: string) {
  const chunks = splitMessage(content);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

// Helper function to send a message and receive a response
async function processAndSendMessage(message: OmitPartialGroupDMChannel<Message<boolean>>, messageType: MessageType) {
  // If batching is enabled, add to batch instead of processing immediately
  if (MESSAGE_BATCH_ENABLED) {
    addMessageToBatch(message, messageType);
    return;
  }

  // Otherwise, process immediately (original behavior)
  try {
    const canRespond = shouldRespondInChannel(message);
    const msg = await sendMessage(message, messageType, canRespond);
    if (msg !== "" && canRespond) {
      await sendSplitReply(message, msg);
      console.log(`Message sent (${msg.length} chars)`);
    } else if (msg !== "" && !canRespond) {
      console.log(`Agent generated response but not responding (not in response channel): ${msg}`);
    }
  } catch (error) {
    console.error("🛑 Error processing and sending message:", error);
  }
}


// Function to start a randomized event timer with improved timing
async function startRandomEventTimer() {
  if (!ENABLE_TIMER) {
      console.log("Timer feature is disabled.");
      return;
  }

  // Set a minimum delay to prevent too-frequent firing (at least 1 minute)
  const minMinutes = 1;
  // Generate random minutes between minMinutes and TIMER_INTERVAL_MINUTES
  const randomMinutes = minMinutes + Math.floor(Math.random() * (TIMER_INTERVAL_MINUTES - minMinutes));
  
  // Log the next timer interval for debugging
  console.log(`⏰ Timer scheduled to fire in ${randomMinutes} minutes`);
  
  const delay = randomMinutes * 60 * 1000; // Convert minutes to milliseconds

  setTimeout(async () => {
      console.log(`⏰ Timer fired after ${randomMinutes} minutes`);
      
      // Determine if the event should fire based on the probability
      if (Math.random() < FIRING_PROBABILITY) {
          console.log(`⏰ Random event triggered (${FIRING_PROBABILITY * 100}% chance)`);

          // Get the channel if available
          let channel: { send: (content: string) => Promise<any> } | undefined = undefined;
          if (CHANNEL_ID) {
              try {
                  const fetchedChannel = await client.channels.fetch(CHANNEL_ID);
                  if (fetchedChannel && 'send' in fetchedChannel) {
                      channel = fetchedChannel as any;
                  } else {
                      console.log("⏰ Channel not found or is not a text channel.");
                  }
              } catch (error) {
                  console.error("⏰ Error fetching channel:", error);
              }
          }

          // Generate the response via the API, passing the channel for async messages
          const msg = await sendTimerMessage(channel);

          // Send the final assistant message if there is one
          if (msg !== "" && channel) {
              try {
                  await sendSplitMessage(channel, msg);
                  console.log(`⏰ Timer message sent to channel (${msg.length} chars)`);
              } catch (error) {
                  console.error("⏰ Error sending timer message:", error);
              }
          } else if (!channel) {
              console.log("⏰ No CHANNEL_ID defined or channel not available; message not sent.");
          }
      } else {
          console.log(`⏰ Random event not triggered (${(1 - FIRING_PROBABILITY) * 100}% chance)`);
      }
      
      // Schedule the next timer with a small delay to prevent immediate restarts
      setTimeout(() => {
          startRandomEventTimer(); 
      }, 1000); // 1 second delay before scheduling next timer
  }, delay);
}

// Handle messages mentioning the bot
client.on('messageCreate', async (message) => {
  if (CHANNEL_ID && message.channel.id !== CHANNEL_ID) {
    // Ignore messages from other channels
    console.log(`📩 Ignoring message from other channels (only listening on channel=${CHANNEL_ID})...`);
    return;
  }

  if (message.author.id === client.user?.id) {
    // Ignore messages from the bot itself
    console.log(`📩 Ignoring message from myself...`);
    return;
  }

  if (message.author.bot && !RESPOND_TO_BOTS) {
    // Ignore other bots
    console.log(`📩 Ignoring other bot...`);
    return;
  }

  // Ignore messages that start with !
  if (message.content.startsWith('!')) {
    console.log(`📩 Ignoring message that starts with !...`);
    return;
  }

  // 📨 Handle Direct Messages (DMs)
  if (message.guild === null) { // If no guild, it's a DM
    console.log(`📩 Received DM from ${message.author.username}: ${message.content}`);
    if (RESPOND_TO_DMS) {
      processAndSendMessage(message, MessageType.DM);
    } else {
      console.log(`📩 Ignoring DM...`);
    }
    return;
  }

  // Check if the bot is mentioned or if the message is a reply to the bot
  const isMention = message.mentions.has(client.user || '');
  let isReplyToBot = false;
  
  // If it's a reply, check if it's to the bot
  if (message.reference && message.reference.messageId) {
    try {
      const originalMessage = await message.channel.messages.fetch(message.reference.messageId);
      isReplyToBot = originalMessage.author.id === client.user?.id;
    } catch (error) {
      console.log(`⚠️ Could not fetch referenced message: ${error instanceof Error ? error.message : error}`);
    }
  }
  
  if (RESPOND_TO_MENTIONS && (isMention || isReplyToBot)) {
    console.log(`📩 Received message from ${message.author.username}: ${message.content}`);

    // Check if we can respond in this channel before showing typing indicator
    const canRespond = shouldRespondInChannel(message);
    console.log(`💬 Can respond in this channel: ${canRespond} (channel=${message.channel.id}, responseChannel=${RESPONSE_CHANNEL_ID || 'any'})`);
    if (canRespond) {
      console.log(`⌨️  Sending typing indicator...`);
      if (REPLY_IN_THREADS && message.guild !== null) {
        if (message.channel.isThread()) {
          await message.channel.sendTyping();
        } else if (message.hasThread) {
          await message.thread!.sendTyping();
        } else {
          await message.channel.sendTyping();
        }
      } else {
        await message.channel.sendTyping();
      }
    } else {
      console.log(`⌨️  Skipping typing indicator (observation-only channel)`);
    }

    let msgContent = message.content;
    let messageType = MessageType.MENTION; // Default to mention

    // If it's a reply to the bot, update message type and content
    if (isReplyToBot && message.reference && message.reference.messageId) {
      try {
        const originalMessage = await message.channel.messages.fetch(message.reference.messageId);
        messageType = MessageType.REPLY;
        msgContent = `[Replying to previous message: "${truncateMessage(originalMessage.content, MESSAGE_REPLY_TRUNCATE_LENGTH)}"] ${msgContent}`;
      } catch (error) {
        console.log(`⚠️ Could not fetch referenced message content: ${error instanceof Error ? error.message : error}`);
      }
    }

    // If batching is enabled, add to batch instead of processing immediately
    if (MESSAGE_BATCH_ENABLED) {
      addMessageToBatch(message, messageType);
      return;
    }

    // Otherwise, process immediately (original behavior)
    const msg = await sendMessage(message, messageType, canRespond);
    if (msg !== "" && canRespond) {
      await sendSplitReply(message, msg);
    } else if (msg !== "" && !canRespond) {
      console.log(`Agent generated response but not responding (not in response channel): ${msg}`);
    }
    return;
  }

  // Catch-all, generic non-mention message
  if (RESPOND_TO_GENERIC) {
    console.log(`📩 Received (non-mention) message from ${message.author.username}: ${message.content}`);
    processAndSendMessage(message, MessageType.GENERIC);
    return;
  }
});

// Start the Discord bot
app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  client.login(process.env.DISCORD_TOKEN);
  startRandomEventTimer();
});