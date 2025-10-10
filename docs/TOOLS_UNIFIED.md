# 🔧 Unified Discord Messaging Tool (Optional Upgrade)

**This is an OPTIONAL alternative to the separate `send_discord_dm` and `send_discord_channel_message` tools.**

---

## 🎯 Why Unified?

**Old approach (2 separate tools):**
- `send_discord_dm(message, user_id)` - Only for DMs
- `send_discord_channel_message(message, channel_id)` - Only for channels

**New approach (1 unified tool):**
- `send_discord_message(message, target, target_type)` - Handles BOTH!
- **Bonus:** Supports @mentions, @everyone, @here pings!

---

## ✨ Additional Features

1. **Automatic target detection** (`target_type="auto"`)
2. **User mentions** (`mention_users=["user_id_1", "user_id_2"]`)
3. **@everyone and @here** pings (channel only)
4. **Auto-chunking** for long messages (2000 char limit)
5. **Memory storage** support (agent remembers what it sent)

---

## 🔨 TOOL: send_discord_message

### JSON Schema

```json
{
  "name": "send_discord_message",
  "description": "Send messages to Discord users (DM) or channels. Supports @mentions, @everyone, @here. Syntax: <@USER_ID> for users, @everyone for all, @here for online. IMPORTANT: After sending, use archival_memory_insert to remember what you said!",
  "parameters": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "Message content. Can be long - auto-splits into chunks. Add mentions like <@USER_ID> in text."
      },
      "target": {
        "type": "string",
        "description": "Discord user ID (for DM) or channel ID (for channel message)"
      },
      "target_type": {
        "type": "string",
        "enum": ["user", "channel", "auto"],
        "description": "user=DM, channel=channel message, auto=auto-detect (default)"
      },
      "mention_users": {
        "type": "array",
        "items": {"type": "string"},
        "description": "List of user IDs to ping. Example: ['701608830852792391']. They get notified!"
      },
      "ping_everyone": {
        "type": "boolean",
        "description": "Ping @everyone (all members). Channel only! Needs permissions!"
      },
      "ping_here": {
        "type": "boolean",
        "description": "Ping @here (online members only). Channel only!"
      }
    },
    "required": ["message", "target"]
  }
}
```

### Python Source Code

```python
import requests
from datetime import datetime

def chunk_message(text: str, limit: int = 1900):
    if len(text) <= limit:
        return [text]
    chunks = []
    i = 0
    while i < len(text):
        end = min(i + limit, len(text))
        slice_text = text[i:end]
        if end < len(text):
            last_newline = slice_text.rfind('\n')
            if last_newline > limit * 0.6:
                end = i + last_newline + 1
                slice_text = text[i:end]
        chunks.append(slice_text)
        i = end
    return chunks

def send_discord_message(message: str, target: str, target_type: str = "auto", mention_users: list = None, ping_everyone: bool = False, ping_here: bool = False, store_in_memory: bool = True):
    # ⚠️ REPLACE with your Discord bot token
    DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"
    
    try:
        headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}", "Content-Type": "application/json"}
        channel_id = None
        is_dm = False
        
        if target_type == "user" or target_type == "auto":
            try:
                dm_response = requests.post("https://discord.com/api/v10/users/@me/channels", json={"recipient_id": target}, headers=headers, timeout=10)
                if dm_response.status_code == 200:
                    channel_id = dm_response.json()["id"]
                    is_dm = True
                elif target_type == "user":
                    return {"status": "error", "message": f"Failed to create DM channel: {dm_response.text}"}
            except Exception as dm_err:
                if target_type == "user":
                    return {"status": "error", "message": f"DM creation failed: {str(dm_err)}"}
        
        if not channel_id:
            if target_type == "channel" or target_type == "auto":
                channel_id = target
                is_dm = False
            else:
                return {"status": "error", "message": "Could not determine target type"}
        
        final_message = message
        mentions_added = []
        
        if mention_users and isinstance(mention_users, list):
            user_pings = " ".join([f"<@{uid}>" for uid in mention_users])
            final_message = f"{user_pings} {final_message}"
            mentions_added.extend([f"@user_{uid}" for uid in mention_users])
        
        if not is_dm:
            if ping_everyone:
                final_message = f"@everyone {final_message}"
                mentions_added.append("@everyone")
            elif ping_here:
                final_message = f"@here {final_message}"
                mentions_added.append("@here")
        
        message_url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
        chunks = chunk_message(final_message)
        sent_message_ids = []
        
        for chunk in chunks:
            response = requests.post(message_url, json={"content": chunk}, headers=headers, timeout=10)
            if response.status_code not in (200, 201):
                return {"status": "error", "message": f"Failed to send: {response.text}", "sent_chunks": len(sent_message_ids), "total_chunks": len(chunks)}
            sent_message_ids.append(response.json()["id"])
        
        target_desc = f"User {target} (DM)" if is_dm else f"Channel {channel_id}"
        chunk_info = f" in {len(chunks)} parts" if len(chunks) > 1 else ""
        timestamp = datetime.now().isoformat()
        
        result = {
            "status": "success",
            "message": f"Message sent to {target_desc}{chunk_info}",
            "target": target,
            "target_type": "dm" if is_dm else "channel",
            "channel_id": channel_id,
            "chunks_sent": len(chunks),
            "message_ids": sent_message_ids,
            "timestamp": timestamp,
            "message_preview": final_message[:100] + "..." if len(final_message) > 100 else final_message,
            "mentions": mentions_added if mentions_added else None
        }
        
        if store_in_memory:
            memory_entry = f"[SENT MESSAGE] {timestamp}\nTo: {target_desc}\nContent: {message[:500]}{'...' if len(message) > 500 else ''}\nStatus: Delivered ({len(chunks)} chunk{'s' if len(chunks) > 1 else ''})"
            result["memory_stored"] = True
            result["memory_entry"] = memory_entry
        
        return result
        
    except Exception as e:
        return {"status": "error", "message": f"Error: {str(e)}", "target": target, "target_type": target_type}
```

---

## 📝 Usage Examples

### Send DM
```python
send_discord_message(
    message="Hey! Meeting at 3pm tomorrow.",
    target="701608830852792391",
    target_type="user"
)
```

### Send to Channel
```python
send_discord_message(
    message="Deploy complete! ✅",
    target="1425770229237284915",
    target_type="channel"
)
```

### Mention Specific Users
```python
send_discord_message(
    message="Please review this!",
    target="1425770229237284915",
    target_type="channel",
    mention_users=["701608830852792391", "123456789"]
)
# Result: "<@701608830852792391> <@123456789> Please review this!"
```

### Ping Everyone
```python
send_discord_message(
    message="IMPORTANT: Server maintenance tonight!",
    target="1425770229237284915",
    target_type="channel",
    ping_everyone=True
)
# Result: "@everyone IMPORTANT: Server maintenance tonight!"
```

### Auto-Detect (try user first, then channel)
```python
send_discord_message(
    message="Hello!",
    target="some_id_here"
    # target_type="auto" is default!
)
```

---

## 🔄 Migration from Separate Tools

If you're currently using `send_discord_dm` and `send_discord_channel_message`:

**Before (2 tools):**
```python
# For DMs
send_discord_dm(message="Hi!", user_id="123")

# For channels
send_discord_channel_message(message="Hello!", channel_id="456")
```

**After (1 unified tool):**
```python
# For DMs
send_discord_message(message="Hi!", target="123", target_type="user")

# For channels
send_discord_message(message="Hello!", target="456", target_type="channel")

# Or just use auto!
send_discord_message(message="Hi!", target="123")  # Detects if DM or channel!
```

---

## ⚙️ Setup in Letta

1. Go to https://app.letta.com/
2. Navigate to your agent → Tools
3. Click "Create new tool"
4. **Name:** `send_discord_message`
5. Copy-paste the Python code above
6. **Replace** `YOUR_DISCORD_BOT_TOKEN_HERE` with your actual token!
7. Save and attach to agent

---

## 🗑️ Optional: Remove Old Tools

After testing the unified tool, you can optionally remove:
- `send_discord_dm`
- `send_discord_channel_message`

The unified tool does everything they did + more!

---

## ⚠️ Important Notes

1. **Memory Storage:** The tool returns `memory_entry` but agent must manually call `archival_memory_insert` to store it
2. **Token Security:** Never commit your Discord bot token to Git!
3. **Permissions:** @everyone/@here require appropriate bot permissions in Discord
4. **Rate Limits:** Discord has rate limits - don't spam!

---

## 🆚 Comparison

| Feature | Separate Tools | Unified Tool |
|---------|---------------|--------------|
| **DM Support** | ✅ `send_discord_dm` | ✅ Same tool |
| **Channel Support** | ✅ `send_discord_channel_message` | ✅ Same tool |
| **Auto-detection** | ❌ Must know type | ✅ Automatic! |
| **@mentions** | ❌ Manual in message | ✅ Built-in param |
| **@everyone/@here** | ❌ Manual in message | ✅ Built-in param |
| **Auto-chunking** | ❌ Must handle manually | ✅ Automatic! |
| **Memory support** | ❌ Not included | ✅ Returns entry |
| **Tools needed** | 2 | 1 |

---

**Recommendation:** Use the unified tool for new setups! It's more flexible and easier to maintain.

---

**Made with ❤️ by the community**

