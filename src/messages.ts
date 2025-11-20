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

enum MessageType {
  DM = "DM",
  MENTION = "MENTION",
  REPLY = "REPLY",
  GENERIC = "GENERIC"
}

// Helper function to split long messages into chunks that fit Discord's limit
function splitMessage(content: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] {
  if (content.length <= limit) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;
  let inCodeBlock = false;
  let codeBlockLang = '';

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = limit;
    let chunk = remaining.substring(0, splitIndex);
    
    // Find all code block markers up to split point
    const codeBlockRegex = /```(\w*)/g;
    let match;
    let blockCount = 0;
    let lastOpenBlock = -1;
    let lastOpenLang = '';
    
    while ((match = codeBlockRegex.exec(chunk)) !== null) {
      blockCount++;
      if (blockCount % 2 === 1) {
        lastOpenBlock = match.index;
        lastOpenLang = match[1] || '';
      }
    }
    
    // Check if we're in a code block at split point
    const wouldBeInBlock = (inCodeBlock && blockCount % 2 === 0) || (!inCodeBlock && blockCount % 2 === 1);
    
    if (wouldBeInBlock) {
      // We're splitting inside a code block
      // Try to find a newline within the block before the limit
      const searchStart = lastOpenBlock > 0 ? lastOpenBlock : 0;
      const lastNewlineInBlock = chunk.lastIndexOf('\n', splitIndex - 1);
      
      if (lastNewlineInBlock > searchStart && lastNewlineInBlock > splitIndex * 0.5) {
        // Split at newline inside block
        splitIndex = lastNewlineInBlock + 1;
        chunk = remaining.substring(0, splitIndex);
        
        // Close the code block
        chunk += '```';
        chunks.push(chunk);
        
        // Next chunk will reopen with same language
        const lang = inCodeBlock ? codeBlockLang : lastOpenLang;
        remaining = '```' + lang + '\n' + remaining.substring(splitIndex);
        inCodeBlock = true;
        codeBlockLang = lang;
        continue;
      } else if (lastOpenBlock > limit * 0.3) {
        // Code block starts late in chunk, break before it
        splitIndex = lastOpenBlock;
        if (splitIndex > 0 && remaining[splitIndex - 1] === '\n') {
          // Include the newline before the code block
        } else {
          // Find previous newline
          const prevNewline = remaining.lastIndexOf('\n', splitIndex - 1);
          if (prevNewline > splitIndex * 0.5) {
            splitIndex = prevNewline + 1;
          }
        }
      } else {
        // Code block is too large, must split inside it
        // Find any newline before limit
        const lastNewline = chunk.lastIndexOf('\n', splitIndex - 1);
        if (lastNewline > splitIndex * 0.5) {
          splitIndex = lastNewline + 1;
        }
        
        chunk = remaining.substring(0, splitIndex) + '```';
        chunks.push(chunk);
        
        const lang = inCodeBlock ? codeBlockLang : lastOpenLang;
        remaining = '```' + lang + '\n' + remaining.substring(splitIndex);
        inCodeBlock = true;
        codeBlockLang = lang;
        continue;
      }
    } else {
      // Not in a code block, use normal splitting logic
      const lastNewline = remaining.lastIndexOf('\n', splitIndex);
      if (lastNewline > splitIndex * 0.5) {
        splitIndex = lastNewline + 1;
      } else {
        const lastSpace = remaining.lastIndexOf(' ', splitIndex);
        if (lastSpace > splitIndex * 0.5) {
          splitIndex = lastSpace + 1;
        }
      }
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex);
    
    // Update code block state for next iteration
    const addedChunk = chunks[chunks.length - 1];
    const blocksInChunk = (addedChunk.match(/```/g) || []).length;
    if (blocksInChunk % 2 === 1) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        const match = /```(\w*)/.exec(addedChunk.substring(addedChunk.lastIndexOf('```')));
        codeBlockLang = match ? match[1] : '';
      }
    }
  }

  return chunks;
}

// Helper function to process stream
const processStream = async (
  response: Stream<LettaStreamingResponse>,
  discordTarget?: OmitPartialGroupDMChannel<Message<boolean>> | { send: (content: string) => Promise<any> }
) => {
  let agentMessageResponse = '';
  const sendAsyncMessage = async (content: string) => {
    if (discordTarget && content.trim()) {
      try {
        if ('reply' in discordTarget) {
          await discordTarget.channel.send(content);
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
              agentMessageResponse += chunk.content;
            }
            break;
          case 'stop_reason':
            console.log('🛑 Stream stopped:', chunk);
            break;
          case 'reasoning_message':
            console.log('🧠 Reasoning:', chunk);
            if ('content' in chunk && typeof chunk.content === 'string') {
              await sendAsyncMessage(`**Reasoning**\n> ${chunk.content}`);
            }
            break;
          case 'tool_call_message':
            console.log('🔧 Tool call:', chunk);
            if ('name' in chunk && typeof chunk.name === 'string') {
              let toolMessage = `**Tool Call (${chunk.name})**`;
              if ('arguments' in chunk && chunk.arguments) {
                toolMessage += `\n> Arguments: ${JSON.stringify(chunk.arguments)}`;
              }
              await sendAsyncMessage(toolMessage);
            }
            break;
          case 'tool_return_message':
            console.log('🔧 Tool return:', chunk);
            if ('name' in chunk && typeof chunk.name === 'string') {
              let returnMessage = `**Tool Return (${chunk.name})**`;
              if ('return_value' in chunk && chunk.return_value) {
                returnMessage += `\n> ${JSON.stringify(chunk.return_value).substring(0, 200)}...`;
              }
              await sendAsyncMessage(returnMessage);
            }
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
  return agentMessageResponse;
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
