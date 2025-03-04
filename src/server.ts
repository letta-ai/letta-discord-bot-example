import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { sendMessage, MessageType } from './messages';


const app = express();
const PORT = process.env.PORT || 3001;
const RESPOND_TO_DMS = process.env.RESPOND_TO_DMS === 'true';
const RESPOND_TO_MENTIONS = process.env.RESPOND_TO_MENTIONS === 'true';
const RESPOND_TO_BOTS = process.env.RESPOND_TO_BOTS === 'true';
const RESPOND_TO_GENERIC = process.env.RESPOND_TO_GENERIC === 'true';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;  // Optional env var,
const TIMEOUT = 1000;
const MESSAGE_REPLY_TRUNCATE_LENGTH = 100;  // how many chars to include

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

  // 📨 Handle Direct Messages (DMs)
  if (message.guild === null) { // If no guild, it's a DM
    console.log(`📩 Received DM from ${message.author.username}: ${message.content}`);
    if (RESPOND_TO_DMS) {
      await message.channel.sendTyping();
      setTimeout(async () => {
        // TODO change to a message type instead of bool
        const msg = await sendMessage(message.author.username, message.author.id, message.content, MessageType.DM);  
        if (msg !== "") {
          await message.reply(msg);
        }
      }, TIMEOUT);
    } else {
      console.log(`📩 Ignoring DM...`);
    }
    return;
  }
// Check if the bot is mentioned or if the message is a reply
if (RESPOND_TO_MENTIONS && (message.mentions.has(client.user || '') || message.reference)) {
    console.log(`📩 Received message from ${message.author.username}: ${message.content}`);
    await message.channel.sendTyping();
    
    setTimeout(async () => {
        let msgContent = message.content;

        // If it's a reply, fetch the original message
        if (message.reference && message.reference.messageId) {
            const originalMessage = await message.channel.messages.fetch(message.reference.messageId);
            msgContent = `[Replying to previous message: "${truncateMessage(originalMessage.content, MESSAGE_REPLY_TRUNCATE_LENGTH)}"] ${msgContent}`;
            const msg = await sendMessage(message.author.username, message.author.id, msgContent, MessageType.REPLY);
            if (msg !== "") {
              await message.reply(msg);
            }
        } else {
            const msg = await sendMessage(message.author.username, message.author.id, msgContent, MessageType.MENTION);
            if (msg !== "") {
              await message.reply(msg);
            }
        }
    }, TIMEOUT);
    return;
}

  // Catch-all, generic non-mention message
  if (RESPOND_TO_GENERIC) {
    console.log(`📩 Received (non-mention) message from ${message.author.username}: ${message.content}`);
    await message.channel.sendTyping();
    setTimeout(async () => {
      const msg = await sendMessage(message.author.username, message.author.id, message.content, MessageType.GENERIC);
      if (msg !== "") {
        await message.reply(msg);
      }
    }, TIMEOUT);
    return;
  }

});


// Start the Discord bot
app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  client.login(process.env.DISCORD_TOKEN);
});