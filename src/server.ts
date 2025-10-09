"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const discord_js_1 = require("discord.js");
const messages_1 = require("./messages");
const attachmentForwarder_1 = require("./listeners/attachmentForwarder");
const letta_client_1 = require("@letta-ai/letta-client");
const taskScheduler_1 = require("./taskScheduler");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const RESPOND_TO_DMS = process.env.RESPOND_TO_DMS === 'true';
const RESPOND_TO_MENTIONS = process.env.RESPOND_TO_MENTIONS === 'true';
const RESPOND_TO_BOTS = process.env.RESPOND_TO_BOTS === 'true';
const RESPOND_TO_GENERIC = process.env.RESPOND_TO_GENERIC === 'true';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; // Optional env var,
const MESSAGE_REPLY_TRUNCATE_LENGTH = 100; // how many chars to include
const ENABLE_TIMER = process.env.ENABLE_TIMER === 'true';
const TIMER_INTERVAL_MINUTES = parseInt(process.env.TIMER_INTERVAL_MINUTES || '15', 10);
const FIRING_PROBABILITY = parseFloat(process.env.FIRING_PROBABILITY || '0.33');
function truncateMessage(message, maxLength) {
    if (message.length > maxLength) {
        return message.substring(0, maxLength - 3) + '...'; // Truncate and add ellipsis
    }
    return message;
}
function chunkText(text, limit) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        let end = Math.min(i + limit, text.length);
        let slice = text.slice(i, end);
        if (end < text.length) {
            const lastNewline = slice.lastIndexOf('\n');
            if (lastNewline > Math.floor(limit * 0.6)) {
                end = i + lastNewline + 1;
                slice = text.slice(i, end);
            }
        }
        chunks.push(slice);
        i = end;
    }
    return chunks;
}
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds, // Needed for commands and mentions
        discord_js_1.GatewayIntentBits.GuildMessages, // Needed to read messages in servers
        discord_js_1.GatewayIntentBits.MessageContent, // Required to read message content
        discord_js_1.GatewayIntentBits.DirectMessages, // Needed to receive DMs
    ],
    partials: [discord_js_1.Partials.Channel] // Required for handling DMs
});
// Register attachment forwarder listener for image attachments
(0, attachmentForwarder_1.registerAttachmentForwarder)(client);
// Discord Bot Ready Event
client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user?.tag}!`);
    // Start background task scheduler loop
    (0, taskScheduler_1.startTaskCheckerLoop)(client);
});
// Helper function to send a message and receive a response
async function processAndSendMessage(message, messageType) {
    try {
        const msg = await (0, messages_1.sendMessage)(message, messageType);
        if (msg !== "") {
            if (msg.length <= 1900) {
                await message.reply(msg);
                console.log(`Message sent: ${msg}`);
            }
            else {
                const chunks = chunkText(msg, 1900);
                // first chunk as reply, rest as follow-ups
                await message.reply(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await new Promise(r => setTimeout(r, 200));
                    await message.channel.send(chunks[i]);
                }
                console.log(`Message sent in ${chunks.length} chunks.`);
            }
        }
    }
    catch (error) {
        console.error("🛑 Error processing and sending message:", error);
    }
}
// Function to start a randomized event timer with improved timing
async function startRandomEventTimer() {
    if (!ENABLE_TIMER) {
        console.log("🜂 Heartbeat feature is disabled.");
        return;
    }
    // Set a minimum delay to prevent too-frequent firing (at least 1 minute)
    const minMinutes = 1;
    // Generate random minutes between minMinutes and TIMER_INTERVAL_MINUTES
    const randomMinutes = minMinutes + Math.floor(Math.random() * (TIMER_INTERVAL_MINUTES - minMinutes));
    // Log the next timer interval for debugging
    console.log(`🜂 Heartbeat scheduled to fire in ${randomMinutes} minutes`);
    const delay = randomMinutes * 60 * 1000; // Convert minutes to milliseconds
    setTimeout(async () => {
        console.log(`🜂 Heartbeat fired after ${randomMinutes} minutes`);
        // Determine if the event should fire based on the probability
        if (Math.random() < FIRING_PROBABILITY) {
            console.log(`🜂 Heartbeat triggered (${FIRING_PROBABILITY * 100}% chance)`);
            // Get the channel if available
            let channel = undefined;
            if (CHANNEL_ID) {
                try {
                    const fetchedChannel = await client.channels.fetch(CHANNEL_ID);
                    if (fetchedChannel && 'send' in fetchedChannel) {
                        channel = fetchedChannel;
                    }
                    else {
                        console.log("⏰ Channel not found or is not a text channel.");
                    }
                }
                catch (error) {
                    console.error("⏰ Error fetching channel:", error);
                }
            }
            // Generate the response via the API, passing the channel for async messages
            const msg = await (0, messages_1.sendTimerMessage)(channel);
            // Send the final assistant message if there is one
            if (msg !== "" && channel) {
                try {
                    await channel.send(msg);
                    console.log("🜂 Heartbeat message sent to channel");
                }
                catch (error) {
                    console.error("🜂 Error sending heartbeat message:", error);
                }
            }
            else if (!channel) {
                console.log("🜂 No CHANNEL_ID defined or channel not available; message not sent.");
            }
        }
        else {
            console.log(`🜂 Heartbeat not triggered (${(1 - FIRING_PROBABILITY) * 100}% chance)`);
        }
        // Schedule the next timer with a small delay to prevent immediate restarts
        setTimeout(() => {
            startRandomEventTimer();
        }, 1000); // 1 second delay before scheduling next timer
    }, delay);
}
// Handle messages mentioning the bot
client.on('messageCreate', async (message) => {
    // Let the attachment forwarder handle image attachments to avoid double replies
    if (message.attachments?.size) {
        for (const [, att] of message.attachments) {
            const ct = att.contentType || att.content_type || '';
            if (typeof ct === 'string' && ct.startsWith('image/')) {
                return;
            }
        }
    }
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
            processAndSendMessage(message, messages_1.MessageType.DM);
        }
        else {
            console.log(`📩 Ignoring DM...`);
        }
        return;
    }
    // Check if the bot is mentioned or if the message is a reply
    if (RESPOND_TO_MENTIONS && (message.mentions.has(client.user || '') || message.reference)) {
        console.log(`📩 Received message from ${message.author.username}: ${message.content}`);
        await message.channel.sendTyping();
        let msgContent = message.content;
        let messageType = messages_1.MessageType.MENTION; // Default to mention
        // If it's a reply, fetch the original message and check if it's to the bot
        if (message.reference && message.reference.messageId) {
            const originalMessage = await message.channel.messages.fetch(message.reference.messageId);
            // Check if the original message was from the bot
            if (originalMessage.author.id === client.user?.id) {
                // This is a reply to the bot
                messageType = messages_1.MessageType.REPLY;
                msgContent = `[Replying to previous message: "${truncateMessage(originalMessage.content, MESSAGE_REPLY_TRUNCATE_LENGTH)}"] ${msgContent}`;
            }
            else {
                // This is a reply to someone else, but the bot is mentioned or it's a generic message
                messageType = message.mentions.has(client.user || '') ? messages_1.MessageType.MENTION : messages_1.MessageType.GENERIC;
            }
        }
        const msg = await (0, messages_1.sendMessage)(message, messageType);
        if (msg !== "") {
            await message.reply(msg);
        }
        return;
    }
    // Catch-all, generic non-mention message
    if (RESPOND_TO_GENERIC) {
        console.log(`📩 Received (non-mention) message from ${message.author.username}: ${message.content}`);
        processAndSendMessage(message, messages_1.MessageType.GENERIC);
        return;
    }
});
// Start the Discord bot
app.listen(PORT, () => {
    console.log('Listening on port', PORT);
    const token = String(process.env.DISCORD_TOKEN || '').trim();
    client.login(token);
    startRandomEventTimer();
});
// --- Optional: Vision/Letta health check endpoint ---
app.get('/tool/letta-health', (req, res) => {
    (async () => {
        const baseUrl = (process.env.LETTA_BASE_URL || 'https://api.letta.com').replace(/\/$/, '');
        const agentId = process.env.LETTA_AGENT_ID;
        const token = process.env.LETTA_API_KEY;
        if (!agentId || !token) {
            res.status(400).json({ ok: false, error: 'Missing LETTA_AGENT_ID or LETTA_API_KEY' });
            return;
        }
        const imageUrl = typeof req.query.image_url === 'string' ? req.query.image_url : undefined;
        const lc = new letta_client_1.LettaClient({ token, baseUrl });
        const content = imageUrl
            ? [{ type: 'image', source: { type: 'url', url: imageUrl } }, { type: 'text', text: 'Health check: describe this image.' }]
            : [{ type: 'text', text: 'this is a Healthtest by Cursor' }];
        const t0 = Date.now();
        await lc.agents.messages.create(agentId, { messages: [{ role: 'user', content }] });
        const dt = Date.now() - t0;
        res.json({ ok: true, baseUrl, vision: !!imageUrl, latency_ms: dt });
    })().catch((e) => {
        res.status(500).json({ ok: false, error: String(e?.message || e) });
    });
});
