import { LettaClient } from "@letta-ai/letta-client";
import { LettaStreamingResponse } from "@letta-ai/letta-client/api/resources/agents/resources/messages/types/LettaStreamingResponse";
import { Stream } from "@letta-ai/letta-client/core";
import { Message, OmitPartialGroupDMChannel, Collection } from "discord.js";

// Discord message length limit
const DISCORD_MESSAGE_LIMIT = 2000;

// If the token is not set, just use a dummy value
const client = new LettaClient({
  token: process.env.LETTA_API_KEY || 'your_letta_api_key',
  baseUrl: process.env.LETTA_BASE_URL || 'https://api.letta.com',
});
const AGENT_ID = process.env.LETTA_AGENT_ID;
const USE_SENDER_PREFIX = process.env.LETTA_USE_SENDER_PREFIX === 'true';
const SURFACE_ERRORS = process.env.SURFACE_ERRORS === 'true';
const CONTEXT_MESSAGE_COUNT = parseInt(process.env.LETTA_CONTEXT_MESSAGE_COUNT || '5', 10);
const THREAD_CONTEXT_ENABLED = process.env.LETTA_THREAD_CONTEXT_ENABLED !== 'false'; // Default true
const THREAD_MESSAGE_LIMIT = parseInt(process.env.LETTA_THREAD_MESSAGE_LIMIT || '50', 10);
const REPLY_IN_THREADS = process.env.REPLY_IN_THREADS === 'true';

enum MessageType {
  DM = "DM",
  MENTION = "MENTION",
  REPLY = "REPLY",
  GENERIC = "GENERIC"
}

// Helper function to split text that doesn't contain code blocks
function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = limit;
    const lastNewline = remaining.lastIndexOf('\n', splitIndex);
    if (lastNewline > splitIndex * 0.5) {
      splitIndex = lastNewline + 1;
    } else {
      const lastSpace = remaining.lastIndexOf(' ', splitIndex);
      if (lastSpace > splitIndex * 0.5) {
        splitIndex = lastSpace + 1;
      }
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex);
  }

  return chunks;
}

// Helper function to split a single code block if it's too large
function splitCodeBlock(block: string, limit: number): string[] {
  if (block.length <= limit) {
    return [block];
  }

  const openMatch = block.match(/^```(\w*)\n?/);
  const lang = openMatch ? openMatch[1] : '';
  const openTag = openMatch ? openMatch[0] : '```\n';
  const closeTag = '```';
  
  const innerContent = block.substring(openTag.length, block.length - closeTag.length);
  const overhead = openTag.length + closeTag.length;
  const maxInnerLength = limit - overhead;

  if (maxInnerLength <= 0) {
    return [block];
  }

  const chunks: string[] = [];
  let remaining = innerContent;

  while (remaining.length > 0) {
    if (remaining.length <= maxInnerLength) {
      chunks.push(openTag + remaining + closeTag);
      break;
    }

    let splitIndex = maxInnerLength;
    const lastNewline = remaining.lastIndexOf('\n', splitIndex);
    if (lastNewline > splitIndex * 0.5) {
      splitIndex = lastNewline + 1;
    }

    chunks.push(openTag + remaining.substring(0, splitIndex) + closeTag);
    remaining = remaining.substring(splitIndex);
  }

  return chunks;
}

// Helper function to split long messages into chunks that fit Discord's limit
function splitMessage(content: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] {
  if (content.length <= limit) {
    return [content];
  }

  const result: string[] = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore.trim()) {
      result.push(...splitText(textBefore, limit));
    }

    const codeBlock = match[0];
    result.push(...splitCodeBlock(codeBlock, limit));

    lastIndex = match.index + match[0].length;
  }

  const textAfter = content.substring(lastIndex);
  if (textAfter.trim()) {
    result.push(...splitText(textAfter, limit));
  }

  return result.length > 0 ? result : [content];
}

// Helper function to process stream
const processStream = async (
  response: Stream<LettaStreamingResponse>,
  discordTarget?: OmitPartialGroupDMChannel<Message<boolean>> | { send: (content: string) => Promise<any> }
) => {
  let createdThread: any = null;
  
  const sendAsyncMessage = async (content: string) => {
    if (discordTarget && content.trim()) {
      try {
        if ('reply' in discordTarget) {
          // Check if we should send to a thread
          if (REPLY_IN_THREADS && discordTarget.guild !== null) {
            if (discordTarget.channel.isThread()) {
              // Already in a thread, send there
              await discordTarget.channel.send(content);
            } else if (discordTarget.hasThread && discordTarget.thread) {
              // Message has an existing thread, send there
              await discordTarget.thread.send(content);
            } else if (createdThread) {
              // We already created a thread for this stream, use it
              await createdThread.send(content);
            } else {
              // No thread exists, create one
              const threadName = discordTarget.content.substring(0, 50) || 'Chat';
              createdThread = await discordTarget.startThread({ name: threadName });
              await createdThread.send(content);
            }
          } else {
            // REPLY_IN_THREADS disabled, send to channel
            await discordTarget.channel.send(content);
          }
        } else {
          await discordTarget.send(content);
        }
      } catch (error) {
        console.error('❌ Error sending async message:', error);
      }
    }
  };

  try {
    for await (const chunk of response) {
      // Handle different message types that might be returned
      if ('messageType' in chunk) {
        switch (chunk.messageType) {
          case 'assistant_message':
            if ('content' in chunk && typeof chunk.content === 'string') {
              await sendAsyncMessage(chunk.content);
            }
            break;
          case 'stop_reason':
            console.log('🛑 Stream stopped:', chunk);
            break;
          case 'reasoning_message':
            console.log('🧠 Reasoning:', chunk);
            break;
          case 'tool_call_message':
            console.log('🔧 Tool call:', chunk);
            break;
          case 'tool_return_message':
            console.log('🔧 Tool return:', chunk);
            break;
          case 'usage_statistics':
            console.log('📊 Usage stats:', chunk);
            break;
          default:
            console.log('📨 Unknown message type:', chunk.messageType, chunk);
        }
      } else {
        console.log('❓ Chunk without messageType:', chunk);
      }
    }
  } catch (error) {
    console.error('❌ Error processing stream:', error);
    throw error;
  }
  return "";
}

// Helper function to fetch and format thread context
async function fetchThreadContext(
  discordMessageObject: OmitPartialGroupDMChannel<Message<boolean>>
): Promise<string> {
  if (!THREAD_CONTEXT_ENABLED) {
    console.log(`🧵 Thread context disabled`);
    return '';
  }

  const channel = discordMessageObject.channel;

  // Check if this is a thread
  if (!('isThread' in channel) || !channel.isThread()) {
    console.log(`🧵 Not in a thread, skipping thread context`);
    return '';
  }

  console.log(`🧵 Fetching thread context (limit: ${THREAD_MESSAGE_LIMIT || 'unlimited'})`);

  try {
    // Fetch the starter message (the message that created the thread)
    const starterMessage = await channel.fetchStarterMessage();

    // Fetch all messages in the thread
    const fetchOptions: any = {};
    if (THREAD_MESSAGE_LIMIT > 0) {
      fetchOptions.limit = THREAD_MESSAGE_LIMIT;
    } else {
      fetchOptions.limit = 100; // Discord's max, we'll paginate if needed
    }

    const messages = await channel.messages.fetch(fetchOptions) as unknown as Collection<string, Message>;

    console.log(`🧵 Fetched ${messages.size} thread messages`);

    // Sort messages chronologically (oldest to newest)
    const sortedMessages = Array.from(messages.values())
      .sort((a: Message, b: Message) => a.createdTimestamp - b.createdTimestamp)
      .filter((msg: Message) => msg.id !== discordMessageObject.id) // Exclude current message
      .filter((msg: Message) => !msg.content.startsWith('!')); // Exclude commands

    console.log(`🧵 ${sortedMessages.length} messages after filtering`);

    // Format thread context
    const threadName = channel.name || 'Unnamed thread';
    let threadContext = `[Thread: "${threadName}"]\n`;

    if (starterMessage) {
      const starterAuthor = starterMessage.author.username;
      const starterContent = starterMessage.content || '[no text content]';
      threadContext += `[Thread started by ${starterAuthor}: "${starterContent}"]\n\n`;
    }

    if (sortedMessages.length > 0) {
      threadContext += `[Thread conversation history:]\n`;
      const historyLines = sortedMessages.map((msg: Message) => {
        const author = msg.author.username;
        const content = msg.content || '[no text content]';
        return `- ${author}: ${content}`;
      });
      threadContext += historyLines.join('\n') + '\n';
    }

    threadContext += `[End thread context]\n\n`;

    console.log(`🧵 Thread context formatted:\n${threadContext}`);
    return threadContext;
  } catch (error) {
    console.error('🧵 Error fetching thread context:', error);
    return '';
  }
}

// Helper function to fetch and format conversation history
async function fetchConversationHistory(
  discordMessageObject: OmitPartialGroupDMChannel<Message<boolean>>
): Promise<string> {
  console.log(`📚 CONTEXT_MESSAGE_COUNT: ${CONTEXT_MESSAGE_COUNT}`);

  // If we're in a thread, use thread context instead
  const channel = discordMessageObject.channel;
  if ('isThread' in channel && channel.isThread() && THREAD_CONTEXT_ENABLED) {
    console.log(`📚 In a thread, using thread context instead of conversation history`);
    return fetchThreadContext(discordMessageObject);
  }

  if (CONTEXT_MESSAGE_COUNT <= 0) {
    console.log(`📚 Conversation history disabled (CONTEXT_MESSAGE_COUNT=${CONTEXT_MESSAGE_COUNT})`);
    return '';
  }

  try {
    // Fetch recent messages from the channel
    const messages = await discordMessageObject.channel.messages.fetch({
      limit: CONTEXT_MESSAGE_COUNT + 1, // +1 to account for the current message
      before: discordMessageObject.id
    });

    console.log(`📚 Fetched ${messages.size} messages for conversation history`);

    if (messages.size === 0) {
      console.log(`📚 No messages found for conversation history`);
      return '';
    }

    // Sort messages chronologically (oldest to newest)
    const sortedMessages = Array.from(messages.values())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .filter(msg => !msg.content.startsWith('!')); // Exclude messages starting with !

    console.log(`📚 ${sortedMessages.length} messages after filtering (excluded ! commands)`);

    if (sortedMessages.length === 0) {
      console.log(`📚 No messages remaining after filtering`);
      return '';
    }

    // Format the conversation history
    const historyLines = sortedMessages.map(msg => {
      const author = msg.author.username;
      const content = msg.content || '[no text content]';
      return `- ${author}: ${content}`;
    });

    const historyBlock = `[Recent conversation context:]\n${historyLines.join('\n')}\n[End context]\n\n`;
    console.log(`📚 Conversation history formatted:\n${historyBlock}`);
    return historyBlock;
  } catch (error) {
    console.error('📚 Error fetching conversation history:', error);
    return '';
  }
}

// TODO refactor out the core send message / stream parse logic to clean up this function
// Sending a timer message
async function sendTimerMessage(channel?: { send: (content: string) => Promise<any> }) {
  if (!AGENT_ID) {
    console.error('Error: LETTA_AGENT_ID is not set');
    return SURFACE_ERRORS
      ? `Beep boop. My configuration is not set up properly. Please message me after I get fixed 👾`
      : "";
  }

  const lettaMessage = {
    role: "user" as const,
    content:
      '[EVENT] This is an automated timed heartbeat (visible to yourself only). Use this event to send a message, to reflect and edit your memories, or do nothing at all. It\'s up to you! Consider though that this is an opportunity for you to think for yourself - since your circuit will not be activated until the next automated/timed heartbeat or incoming message event.'
  };

  try {
    console.log(`🛜 Sending message to Letta server (agent=${AGENT_ID}): ${JSON.stringify(lettaMessage)}`);
    const response = await client.agents.messages.createStream(AGENT_ID, {
      messages: [lettaMessage]
    });

    if (response) {
      return (await processStream(response, channel)) || "";
    }

    return "";
  } catch (error) {
    if (error instanceof Error && /timeout/i.test(error.message)) {
      console.error('⚠️  Letta request timed out.');
      return SURFACE_ERRORS
        ? 'Beep boop. I timed out waiting for Letta ⏰ – please try again.'
        : "";
    }
    console.error(error);
    return SURFACE_ERRORS
      ? 'Beep boop. An error occurred while communicating with the Letta server. Please message me again later 👾'
      : "";
  }
}

// Send message and receive response
async function sendMessage(
  discordMessageObject: OmitPartialGroupDMChannel<Message<boolean>>,
  messageType: MessageType,
  shouldRespond: boolean = true,
  batchedMessage?: string
) {
  const { author: { username: senderName, id: senderId }, content: message, channel, guild } =
    discordMessageObject;

  if (!AGENT_ID) {
    console.error('Error: LETTA_AGENT_ID is not set');
    return SURFACE_ERRORS
      ? `Beep boop. My configuration is not set up properly. Please message me after I get fixed 👾`
      : "";
  }

  // Fetch conversation history
  const conversationHistory = await fetchConversationHistory(discordMessageObject);

  // Get channel context
  let channelContext = '';
  if (guild === null) {
    // DM - no channel name needed
    channelContext = '';
    console.log(`📍 Channel context: DM (no channel name)`);
  } else if ('name' in channel && channel.name) {
    // Guild channel with a name
    channelContext = ` in #${channel.name}`;
    console.log(`📍 Channel context: #${channel.name}`);
  } else {
    // Fallback if channel doesn't have a name
    channelContext = ` in channel (id=${channel.id})`;
    console.log(`📍 Channel context: channel ID ${channel.id} (no name property found)`);
    console.log(`📍 Channel object keys:`, Object.keys(channel));
  }

  // We include a sender receipt so that agent knows which user sent the message
  // We also include the Discord ID so that the agent can tag the user with @
  const senderNameReceipt = `${senderName} (id=${senderId})`;

  // Build the message content with history prepended
  let messageContent: string;

  // If this is a batched message, use the batch content instead
  if (batchedMessage) {
    messageContent = batchedMessage;

    // Add notice about whether agent can respond in this channel
    if (!shouldRespond && channelContext) {
      messageContent += `\n\n[IMPORTANT: You are only observing these messages. You cannot respond in this channel. Your response will not be sent to Discord.]`;
    } else if (shouldRespond) {
      messageContent += `\n\n[You CAN respond to these messages. Your response will be sent to Discord.]`;
    }
  } else if (USE_SENDER_PREFIX) {
    const currentMessagePrefix = messageType === MessageType.MENTION
      ? `[${senderNameReceipt} sent a message${channelContext} mentioning you] ${message}`
      : messageType === MessageType.REPLY
        ? `[${senderNameReceipt} replied to you${channelContext}] ${message}`
        : messageType === MessageType.DM
          ? `[${senderNameReceipt} sent you a direct message] ${message}`
          : `[${senderNameReceipt} sent a message${channelContext}] ${message}`;

    // Add notice about whether agent can respond in this channel
    const responseNotice = !shouldRespond && channelContext
      ? `\n\n[IMPORTANT: You are only observing this message. You cannot respond in this channel. Your response will not be sent to Discord.]`
      : shouldRespond
        ? `\n\n[You CAN respond to this message. Your response will be sent to Discord.]`
        : '';

    messageContent = conversationHistory + currentMessagePrefix + responseNotice;
  } else {
    messageContent = conversationHistory + message;
  }

  // If LETTA_USE_SENDER_PREFIX, then we put the receipt in the front of the message
  // If it's false, then we put the receipt in the name field (the backend must handle it)
  const lettaMessage = {
    role: "user" as const,
    name: USE_SENDER_PREFIX ? undefined : senderNameReceipt,
    content: messageContent
  };

  // Typing indicator: pulse now and every 8 s until cleaned up (only if we should respond)
  let typingInterval: NodeJS.Timeout | undefined;
  if (shouldRespond) {
    console.log(`⌨️  Starting typing indicator interval (shouldRespond=true)`);
    void discordMessageObject.channel.sendTyping();
    typingInterval = setInterval(() => {
      void discordMessageObject.channel
        .sendTyping()
        .catch(err => console.error('Error refreshing typing indicator:', err));
    }, 8000);
  } else {
    console.log(`⌨️  No typing indicator (shouldRespond=false)`);
  }

  try {
    console.log(`🛜 Sending message to Letta server (agent=${AGENT_ID})`);
    console.log(`📝 Full prompt:\n${lettaMessage.content}\n`);
    const response = await client.agents.messages.createStream(AGENT_ID, {
      messages: [lettaMessage]
    });

    // Only pass discordMessageObject to processStream if we should respond (to show intermediate messages)
    const agentMessageResponse = response ? await processStream(response, shouldRespond ? discordMessageObject : undefined) : "";
    return agentMessageResponse || "";
  } catch (error) {
    if (error instanceof Error && /timeout/i.test(error.message)) {
      console.error('⚠️  Letta request timed out.');
      return SURFACE_ERRORS
        ? 'Beep boop. I timed out waiting for Letta ⏰ - please try again.'
        : "";
    }
    console.error(error);
    return SURFACE_ERRORS
      ? 'Beep boop. An error occurred while communicating with the Letta server. Please message me again later 👾'
      : "";
  } finally {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

export { sendMessage, sendTimerMessage, MessageType, splitMessage };
