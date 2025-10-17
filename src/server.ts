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
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;  // Optional: only listen in this channel
const RESPONSE_CHANNEL_ID = process.env.DISCORD_RESPONSE_CHANNEL_ID;  // Optional: only respond in this channel
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

// Helper function to check if bot should respond in this channel
function shouldRespondInChannel(channelId: string): boolean {
  // If RESPONSE_CHANNEL_ID is not set, respond everywhere
  if (!RESPONSE_CHANNEL_ID) {
    return true;
  }
  // If RESPONSE_CHANNEL_ID is set, only respond in that channel
  return channelId === RESPONSE_CHANNEL_ID;
}

// Helper function to send a message and receive a response
async function processAndSendMessage(message: OmitPartialGroupDMChannel<Message<boolean>>, messageType: MessageType) {
  try {
    const canRespond = shouldRespondInChannel(message.channel.id);
    const msg = await sendMessage(message, messageType, canRespond);
    if (msg !== "" && canRespond) {
      await message.reply(msg);
      console.log(`Message sent: ${msg}`);
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
                  await channel.send(msg);
                  console.log("⏰ Timer message sent to channel");
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

  // Check if the bot is mentioned or if the message is a reply
  if (RESPOND_TO_MENTIONS && (message.mentions.has(client.user || '') || message.reference)) {
    console.log(`📩 Received message from ${message.author.username}: ${message.content}`);
    await message.channel.sendTyping();
    
    let msgContent = message.content;
    let messageType = MessageType.MENTION; // Default to mention

    // If it's a reply, fetch the original message and check if it's to the bot
    if (message.reference && message.reference.messageId) {
        const originalMessage = await message.channel.messages.fetch(message.reference.messageId);
        
        // Check if the original message was from the bot
        if (originalMessage.author.id === client.user?.id) {
          // This is a reply to the bot
          messageType = MessageType.REPLY;
          msgContent = `[Replying to previous message: "${truncateMessage(originalMessage.content, MESSAGE_REPLY_TRUNCATE_LENGTH)}"] ${msgContent}`;
        } else {
          // This is a reply to someone else, but the bot is mentioned or it's a generic message
          messageType = message.mentions.has(client.user || '') ? MessageType.MENTION : MessageType.GENERIC;
        }
    }
    
    const canRespond = shouldRespondInChannel(message.channel.id);
    const msg = await sendMessage(message, messageType, canRespond);
    if (msg !== "" && canRespond) {
      await message.reply(msg);
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