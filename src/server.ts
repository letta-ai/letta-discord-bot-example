import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits, Message, OmitPartialGroupDMChannel, Partials } from 'discord.js';
import { sendMessage, sendTimerMessage, MessageType } from './messages';


const app = express();
const PORT = process.env.PORT || 3001;
const RESPOND_TO_DMS = process.env.RESPOND_TO_DMS === 'true';
const RESPOND_TO_MENTIONS = process.env.RESPOND_TO_MENTIONS === 'true';
const RESPOND_TO_BOTS = process.env.RESPOND_TO_BOTS === 'true';
const RESPOND_TO_GENERIC = process.env.RESPOND_TO_GENERIC === 'true';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;  // Optional env var,
const MESSAGE_REPLY_TRUNCATE_LENGTH = 100;  // how many chars to include
const ENABLE_TIMER = process.env.ENABLE_TIMER === 'true';
const TIMER_INTERVAL_MINUTES = parseInt(process.env.TIMER_INTERVAL_MINUTES || '15', 10);
const FIRING_PROBABILITY = parseFloat(process.env.FIRING_PROBABILITY || '0.1');

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

// Discord Bot Ready Event
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user?.tag}!`);
});

// Helper function to send a message and receive a response
async function processAndSendMessage(message: OmitPartialGroupDMChannel<Message<boolean>>, messageType: MessageType) {
  try {
    const msg = await sendMessage(message, messageType)
    if (msg !== "") {
      await message.reply(msg);
      console.log(`Message sent: ${msg}`);
    }
  } catch (error) {
    console.error("🛑 Error processing and sending message:", error);
  }
}

// Function to start a randomized event timer
async function startRandomEventTimer() {
  if (!ENABLE_TIMER) {
      console.log("Timer feature is disabled.");
      return;
  }

  const randomMinutes = Math.floor(Math.random() * TIMER_INTERVAL_MINUTES);
  const delay = randomMinutes * 60 * 1000; // Convert minutes to milliseconds

  setTimeout(async () => {
      // Determine if the event should fire based on the probability
      if (Math.random() < FIRING_PROBABILITY) {

          // Generate the response via the Letta API
          const msg = await sendTimerMessage();

          // Pass that response to Discord
          if (msg !== "") {
            if (CHANNEL_ID) {
                const channel = await client.channels.fetch(CHANNEL_ID);
                if (channel && channel.isTextBased() && 'send' in channel) {
                    await channel.send(msg);
                } else {
                    console.log("Channel not found or is not a text channel.");
                }
            } else {
                console.log("No CHANNEL_ID defined; message not sent.");
            }
          }
      }
      startRandomEventTimer(); // Restart the timer
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

  // Check if the bot is mentioned or if the message is a reply
  if (RESPOND_TO_MENTIONS && (message.mentions.has(client.user || '') || message.reference)) {
    console.log(`📩 Received message from ${message.author.username}: ${message.content}`);
    await message.channel.sendTyping();
    
    let msgContent = message.content;

    // If it's a reply, fetch the original message
    if (message.reference && message.reference.messageId) {
        const originalMessage = await message.channel.messages.fetch(message.reference.messageId);
        msgContent = `[Replying to previous message: "${truncateMessage(originalMessage.content, MESSAGE_REPLY_TRUNCATE_LENGTH)}"] ${msgContent}`;
        const msg = await sendMessage(message, MessageType.REPLY);
        if (msg !== "") {
          await message.reply(msg);
        }
    } else {
        const msg = await sendMessage(message, MessageType.MENTION);
        if (msg !== "") {
          await message.reply(msg);
        }
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
  startRandomEventTimer(); // Replace with actual agent ID
});