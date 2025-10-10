# 💬 Discord API Reference

Quick reference for Discord Bot API - the essentials you need for bot development.

**Official Docs:** https://discord.com/developers/docs  
**API Base:** `https://discord.com/api/v10`  
**Bot Token:** Get from https://discord.com/developers/applications

---

## 🔑 Authentication

All bot requests require:
```bash
-H "Authorization: Bot YOUR_BOT_TOKEN"
-H "Content-Type: application/json"
```

**⚠️ Security:** NEVER commit your bot token! Use environment variables!

```bash
export DISCORD_TOKEN="MTQyMzYzNDEzOTk4NjM5OTI2Mg.GjRl1t..."
```

---

## 📨 Sending Messages

### Send DM to User

**Two-step process:**
1. Create DM channel
2. Send message to that channel

```bash
# Step 1: Create DM Channel
curl -X POST "https://discord.com/api/v10/users/@me/channels" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient_id": "USER_ID_HERE"
  }'
```

**Response:**
```json
{
  "id": "123456789012345678",
  "type": 1,
  "recipients": [...]
}
```

```bash
# Step 2: Send Message
curl -X POST "https://discord.com/api/v10/channels/CHANNEL_ID/messages" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello from your bot!"
  }'
```

### Send Message to Channel

```bash
POST /channels/{channel_id}/messages
```

```bash
curl -X POST "https://discord.com/api/v10/channels/CHANNEL_ID/messages" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Message text here"
  }'
```

**With Mentions:**
```bash
curl -X POST "https://discord.com/api/v10/channels/CHANNEL_ID/messages" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "<@USER_ID> Hello! This mentions you!"
  }'
```

**With @everyone:**
```bash
curl -X POST "https://discord.com/api/v10/channels/CHANNEL_ID/messages" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "@everyone Important announcement!"
  }'
```

**⚠️ Permissions Required:**
- `@everyone` / `@here` → Need `MENTION_EVERYONE` permission
- User mentions → Always allowed

**Response:**
```json
{
  "id": "987654321098765432",
  "channel_id": "123456789012345678",
  "content": "Message text here",
  "timestamp": "2025-10-10T12:00:00.000000+00:00",
  "author": {
    "id": "BOT_USER_ID",
    "username": "My Bot",
    "bot": true,
    ...
  },
  ...
}
```

---

## 📖 Reading Messages

### Get Channel Messages

```bash
GET /channels/{channel_id}/messages
```

**Parameters:**
- `limit` - Number of messages (1-100, default 50)
- `before` - Get messages before this message ID
- `after` - Get messages after this message ID
- `around` - Get messages around this message ID

```bash
# Get last 50 messages
curl "https://discord.com/api/v10/channels/CHANNEL_ID/messages?limit=50" \
  -H "Authorization: Bot YOUR_BOT_TOKEN"
```

```bash
# Get messages before a specific ID (pagination)
curl "https://discord.com/api/v10/channels/CHANNEL_ID/messages?limit=100&before=MESSAGE_ID" \
  -H "Authorization: Bot YOUR_BOT_TOKEN"
```

**Response:**
```json
[
  {
    "id": "message_id",
    "content": "Message text",
    "author": {
      "id": "user_id",
      "username": "Username",
      "discriminator": "0001",
      ...
    },
    "timestamp": "2025-10-10T12:00:00.000000+00:00",
    "attachments": [...],
    ...
  }
]
```

---

## 📂 Channels & Guilds

### List Guilds (Servers)

```bash
GET /users/@me/guilds
```

```bash
curl "https://discord.com/api/v10/users/@me/guilds" \
  -H "Authorization: Bot YOUR_BOT_TOKEN"
```

**Response:**
```json
[
  {
    "id": "guild_id",
    "name": "Server Name",
    "icon": "icon_hash",
    "owner": false,
    "permissions": "permissions_integer",
    ...
  }
]
```

### List Guild Channels

```bash
GET /guilds/{guild_id}/channels
```

```bash
curl "https://discord.com/api/v10/guilds/GUILD_ID/channels" \
  -H "Authorization: Bot YOUR_BOT_TOKEN"
```

**Response:**
```json
[
  {
    "id": "channel_id",
    "type": 0,
    "name": "general",
    "position": 0,
    "permission_overwrites": [...],
    ...
  }
]
```

**Channel Types:**
- `0` - Guild text channel
- `1` - DM
- `2` - Guild voice channel
- `4` - Guild category
- `5` - Guild announcement channel
- `10` - Announcement thread
- `11` - Public thread
- `12` - Private thread
- `13` - Guild stage channel
- `15` - Guild forum channel

---

## 🖼️ Attachments & Files

### Send Message with File

```bash
curl -X POST "https://discord.com/api/v10/channels/CHANNEL_ID/messages" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -F "content=Check out this image!" \
  -F "file=@/path/to/image.png"
```

**Multiple Files:**
```bash
curl -X POST "https://discord.com/api/v10/channels/CHANNEL_ID/messages" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -F "content=Multiple files" \
  -F "files[0]=@/path/to/file1.png" \
  -F "files[1]=@/path/to/file2.jpg"
```

### Download Attachment

Attachments have a `url` field in message objects:

```json
{
  "attachments": [
    {
      "id": "attachment_id",
      "filename": "image.png",
      "size": 123456,
      "url": "https://cdn.discordapp.com/attachments/...",
      "proxy_url": "https://media.discordapp.net/attachments/...",
      "width": 1920,
      "height": 1080
    }
  ]
}
```

```bash
# Download
curl "https://cdn.discordapp.com/attachments/..." -o image.png
```

---

## ⚙️ Bot Gateway (WebSocket)

For real-time events (message create, reactions, etc.), use the Gateway.

**Gateway URL:** `wss://gateway.discord.gg/?v=10&encoding=json`

**Not covered here - use a library:**
- **Node.js:** `discord.js`
- **Python:** `discord.py`
- **Rust:** `serenity`

---

## 🚦 Rate Limits

**Global Rate Limit:** 50 requests per second

**Per-route limits:**
- Message creation: 5/5s per channel
- DM channel creation: 10/10m
- Guild operations: Varies

**Headers:**
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4
X-RateLimit-Reset: 1570897680
X-RateLimit-Bucket: abcd1234
```

**When Rate Limited:**
```json
{
  "message": "You are being rate limited.",
  "retry_after": 64.57,
  "global": false
}
```

**Best Practices:**
1. Check `X-RateLimit-Remaining` header
2. Implement exponential backoff
3. Queue messages instead of spamming
4. Respect `Retry-After` header

---

## 🔍 Common Patterns

### Message Chunking (2000 char limit)

Discord messages have a 2000 character limit!

```python
def chunk_message(text, limit=1900):
    if len(text) <= limit:
        return [text]
    
    chunks = []
    i = 0
    while i < len(text):
        end = min(i + limit, len(text))
        slice_text = text[i:end]
        
        # Try to break at newline
        if end < len(text):
            last_newline = slice_text.rfind('\n')
            if last_newline > limit * 0.6:
                end = i + last_newline + 1
                slice_text = text[i:end]
        
        chunks.append(slice_text)
        i = end
    
    return chunks

# Send each chunk
for chunk in chunk_message(long_text):
    send_message(channel_id, chunk)
```

### Mention Formatting

```python
# User mention
f"<@{user_id}>"  # → @Username

# Channel mention
f"<#{channel_id}>"  # → #channel-name

# Role mention
f"<@&{role_id}>"  # → @RoleName

# Everyone/Here
"@everyone"  # → Pings everyone
"@here"      # → Pings online users

# Emoji
f"<:emoji_name:{emoji_id}>"  # → Custom emoji
":smile:"                     # → Unicode emoji
```

### Time-based Message Filtering

```bash
# Messages from last hour
TIMESTAMP=$(date -u -d '1 hour ago' +%s)
MESSAGE_ID=$(python3 -c "print((($TIMESTAMP * 1000 - 1420070400000) << 22))")

curl "https://discord.com/api/v10/channels/CHANNEL_ID/messages?after=$MESSAGE_ID" \
  -H "Authorization: Bot YOUR_BOT_TOKEN"
```

**Message ID to Timestamp:**
```python
def snowflake_to_timestamp(snowflake_id):
    timestamp = ((int(snowflake_id) >> 22) + 1420070400000) / 1000
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)
```

---

## ⚠️ Error Handling

### Common Errors

**Missing Permissions (403):**
```json
{
  "message": "Missing Permissions",
  "code": 50013
}
```

**Unknown Channel (404):**
```json
{
  "message": "Unknown Channel",
  "code": 10003
}
```

**Cannot send to user (50007):**
```json
{
  "message": "Cannot send messages to this user",
  "code": 50007
}
```
**Cause:** User has DMs disabled or has blocked the bot

**Invalid Form Body (400):**
```json
{
  "message": "Invalid Form Body",
  "code": 50035,
  "errors": {
    "content": {
      "_errors": [
        {
          "code": "BASE_TYPE_MAX_LENGTH",
          "message": "Must be 2000 or fewer in length."
        }
      ]
    }
  }
}
```

### Error Codes Reference

| Code | Meaning |
|------|---------|
| 10003 | Unknown Channel |
| 10004 | Unknown Guild |
| 10008 | Unknown Message |
| 10013 | Unknown User |
| 20001 | Bots cannot use this endpoint |
| 50001 | Missing Access |
| 50007 | Cannot send to user |
| 50013 | Missing Permissions |
| 50035 | Invalid Form Body |

**Full list:** https://discord.com/developers/docs/topics/opcodes-and-status-codes

---

## 💡 Best Practices

### 1. Never Commit Bot Token

```bash
# ❌ BAD
const token = "MTQyMzYz...";

# ✅ GOOD
const token = process.env.DISCORD_TOKEN;
```

### 2. Validate Before Sending

```javascript
// Check message length
if (message.length > 2000) {
  message = message.substring(0, 1997) + "...";
}

// Check if channel exists
try {
  await channel.fetch();
} catch {
  console.error("Channel not found!");
  return;
}
```

### 3. Handle DM Failures Gracefully

```javascript
try {
  await user.send("Hello!");
} catch (error) {
  if (error.code === 50007) {
    console.log("User has DMs disabled");
    // Maybe send to a channel instead?
  }
}
```

### 4. Use Embeds for Rich Content

```bash
curl -X POST "https://discord.com/api/v10/channels/CHANNEL_ID/messages" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "embeds": [{
      "title": "Embed Title",
      "description": "Embed description",
      "color": 5814783,
      "fields": [
        {"name": "Field 1", "value": "Value 1", "inline": true},
        {"name": "Field 2", "value": "Value 2", "inline": true}
      ],
      "timestamp": "2025-10-10T12:00:00.000Z"
    }]
  }'
```

### 5. Implement Retry Logic

```python
import time

def send_with_retry(channel_id, content, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = send_message(channel_id, content)
            return response
        except RateLimitError as e:
            if attempt < max_retries - 1:
                time.sleep(e.retry_after)
            else:
                raise
```

---

## 🔗 Useful Links

- **Official Docs:** https://discord.com/developers/docs
- **API Reference:** https://discord.com/developers/docs/reference
- **Developer Portal:** https://discord.com/developers/applications
- **Rate Limits:** https://discord.com/developers/docs/topics/rate-limits
- **Error Codes:** https://discord.com/developers/docs/topics/opcodes-and-status-codes
- **Discord Developers Server:** https://discord.gg/discord-developers

---

## 📚 Libraries

Instead of raw API calls, consider using a library:

**JavaScript/TypeScript:**
- [`discord.js`](https://discord.js.org/) - Most popular
- [`eris`](https://abal.moe/Eris/) - Lightweight alternative

**Python:**
- [`discord.py`](https://discordpy.readthedocs.io/) - Most popular
- [`nextcord`](https://nextcord.dev/) - Fork with active development

**Rust:**
- [`serenity`](https://github.com/serenity-rs/serenity) - Async-first
- [`twilight`](https://twilight.rs/) - Modular approach

**Go:**
- [`discordgo`](https://github.com/bwmarrin/discordgo) - Simple & effective

---

**Last Updated:** 2025-10-10  
**API Version:** v10  
**Created by:** Mioré 🐾

