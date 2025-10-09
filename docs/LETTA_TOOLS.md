# Discord Tools for Letta Agents - Setup Guide

**Complete tool configuration for Discord integration with Letta AI agents**

---

## 🎯 What This Is

A set of 5 custom tools that enable your Letta agent to:
- Send direct messages to Discord users
- Post messages in Discord channels
- Create scheduled tasks and reminders
- Delete scheduled tasks
- Read DM conversation history with time filtering

These tools bridge the gap between Letta's AI capabilities and Discord's messaging platform.

---

## 📋 Prerequisites

Before you start, you'll need:

- [ ] Letta Cloud account
- [ ] Letta API key
- [ ] Letta agent ID
- [ ] Discord bot token (from Discord Developer Portal)
- [ ] Discord bot invited to your server with proper permissions
- [ ] Tasks channel ID (optional, for scheduling features)

---

## 🔧 Configuration Values

**⚠️ IMPORTANT:** Replace these placeholders in ALL tools below:

```python
DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"  # From Discord Developer Portal
TASKS_CHANNEL_ID = "YOUR_TASKS_CHANNEL_ID_HERE"   # Right-click channel → Copy ID (for scheduling)
DEFAULT_USER_ID = "YOUR_DISCORD_USER_ID_HERE"      # Right-click yourself → Copy ID (default recipient)
```

**How to get these values:**

1. **Discord Bot Token:**
   - Go to https://discord.com/developers/applications
   - Select your application → Bot → Reset Token → Copy

2. **Channel ID / User ID:**
   - Enable Developer Mode: Discord → Settings → Advanced → Developer Mode
   - Right-click channel/user → Copy ID

---

## 📝 How to Add Tools to Letta

### Via Letta Web Interface (Recommended):

1. Go to https://app.letta.com/
2. Select your agent
3. Navigate to **"Tools"** tab
4. Click **"Create new tool"**
5. Enter tool name (e.g., `send_discord_dm`)
6. Paste the **Source Code** (Python) from below
7. The JSON schema will be auto-generated
8. Click **"Create tool"**
9. Repeat for all 4 tools

### Via Letta API:

See the complete setup example at the bottom of this document.

---

## 🔨 TOOL 1: send_discord_dm

Send a direct message to a Discord user.

**Name:** `send_discord_dm`

**JSON Schema:**
```json
{
  "name": "send_discord_dm",
  "description": "Sends a direct message to a Discord user.",
  "parameters": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "The message content to send"
      },
      "user_id": {
        "type": "string",
        "description": "The Discord user ID of the recipient"
      }
    },
    "required": ["message", "user_id"]
  }
}
```

**Source Code:**
```python
import requests

def chunk_message(text: str, limit: int = 1900):
    """Split long messages into chunks to respect Discord's 2000 char limit"""
    if len(text) <= limit:
        return [text]
    chunks = []
    i = 0
    while i < len(text):
        end = min(i + limit, len(text))
        chunks.append(text[i:end])
        i = end
    return chunks

def send_discord_dm(message: str, user_id: str):
    # ⚠️ REPLACE THIS with your Discord bot token
    DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"
    
    try:
        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json"
        }
        
        # Step 1: Create DM channel
        response = requests.post(
            "https://discord.com/api/v10/users/@me/channels",
            json={"recipient_id": user_id},
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            return {"status": "error", "message": f"Failed to create DM channel: {response.text}"}
        
        channel_id = response.json()["id"]
        message_url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
        
        # Step 2: Send message (split if too long)
        chunks = chunk_message(message)
        
        for chunk in chunks:
            response = requests.post(
                message_url, 
                json={"content": chunk}, 
                headers=headers,
                timeout=10
            )
            
            if response.status_code not in (200, 201):
                return {"status": "error", "message": f"Failed to send message: {response.text}"}
        
        chunk_info = f" ({len(chunks)} parts)" if len(chunks) > 1 else ""
        return {"status": "success", "message": f"DM sent to user {user_id}{chunk_info}"}
        
    except Exception as e:
        return {"status": "error", "message": f"Error: {str(e)}"}
```

**Example Usage:**
```
User → Agent: "Send John a DM about the meeting"
Agent → Calls: send_discord_dm(message="Hi John! Meeting tomorrow at 3pm.", user_id="123456789")
Result → User receives DM ✅
```

---

## 🔨 TOOL 2: send_discord_channel_message

Post a message in a Discord channel.

**Name:** `send_discord_channel_message`

**JSON Schema:**
```json
{
  "name": "send_discord_channel_message",
  "description": "Sends a message to a specific Discord channel.",
  "parameters": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "The message content to send"
      },
      "channel_id": {
        "type": "string",
        "description": "The Discord channel ID"
      }
    },
    "required": ["message", "channel_id"]
  }
}
```

**Source Code:**
```python
import requests

def chunk_message(text: str, limit: int = 1900):
    """Split long messages into chunks to respect Discord's 2000 char limit"""
    if len(text) <= limit:
        return [text]
    chunks = []
    i = 0
    while i < len(text):
        end = min(i + limit, len(text))
        chunks.append(text[i:end])
        i = end
    return chunks

def send_discord_channel_message(message: str, channel_id: str):
    # ⚠️ REPLACE THIS with your Discord bot token
    DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"
    
    try:
        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json"
        }
        
        message_url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
        chunks = chunk_message(message)
        
        sent_message_ids = []
        for chunk in chunks:
            response = requests.post(
                message_url,
                json={"content": chunk},
                headers=headers,
                timeout=10
            )
            
            if response.status_code not in (200, 201):
                return {"status": "error", "message": f"Failed to send message: {response.text}"}
            
            sent_message_ids.append(response.json()["id"])
        
        chunk_info = f" ({len(chunks)} parts)" if len(chunks) > 1 else ""
        return {
            "status": "success",
            "message": f"Message sent to channel {channel_id}{chunk_info}",
            "message_ids": sent_message_ids
        }
        
    except Exception as e:
        return {"status": "error", "message": f"Error: {str(e)}"}
```

**Example Usage:**
```
User → Agent: "Post an update in #general"
Agent → Calls: send_discord_channel_message(message="Update: All systems operational! ✅", channel_id="987654321")
Result → Message appears in channel ✅
```

---

## 🔨 TOOL 3: create_scheduled_task

Create a scheduled task with flexible timing (one-time or recurring).

**Name:** `create_scheduled_task`

**JSON Schema:**
```json
{
  "name": "create_scheduled_task",
  "description": "Creates a scheduled or one-time task with extended rhythm options (daily, weekly, monthly, yearly, minutely, hourly, every_X_days, etc.). After creation, the task will be stored automatically.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_name": {
        "type": "string",
        "description": "Unique name for this task."
      },
      "description": {
        "type": "string",
        "description": "Human-readable summary of what this task does."
      },
      "schedule": {
        "type": "string",
        "description": "Timing for execution. Supported: 'in_X_minutes', 'in_X_hours', 'in_X_seconds', 'tomorrow_at_HH:MM', 'daily', 'hourly', 'weekly', 'monthly', 'yearly', 'minutely', 'every_X_minutes', 'every_X_hours', 'every_X_days', 'every_X_weeks'."
      },
      "time": {
        "type": "string",
        "description": "Time in HH:MM format for daily schedules (optional)."
      },
      "action_type": {
        "type": "string",
        "description": "Defines what happens when triggered: 'user_reminder' (DM) or 'channel_post' (channel message)."
      },
      "action_target": {
        "type": "string",
        "description": "For 'user_reminder': Discord user_id. For 'channel_post': channel_id."
      },
      "action_template": {
        "type": "string",
        "description": "The message template to send when this task runs. You can personalize/rewrite this."
      }
    },
    "required": [
      "task_name",
      "description",
      "schedule",
      "action_type",
      "action_template"
    ]
  }
}
```

**Source Code:**
```python
import json
import requests
from datetime import datetime, timedelta

def create_scheduled_task(
    task_name: str,
    description: str,
    schedule: str,
    action_type: str,
    action_template: str,
    time: str = None,
    action_target: str = None
):
    # ⚠️ REPLACE THESE with your configuration
    DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"
    TASKS_CHANNEL_ID = "YOUR_TASKS_CHANNEL_ID_HERE"
    DEFAULT_USER_ID = "YOUR_DISCORD_USER_ID_HERE"
    
    """
    Creates a scheduled or one-time task with flexible rhythm
    """
    try:
        now = datetime.now()
        one_time = schedule.startswith("in_") or schedule.startswith("tomorrow_")
        
        # --- Calculate next run time ---
        if schedule.startswith("in_") and schedule.endswith("_minutes"):
            minutes = int(schedule.split("_")[1])
            next_run = now + timedelta(minutes=minutes)
        elif schedule.startswith("in_") and schedule.endswith("_hours"):
            hours = int(schedule.split("_")[1])
            next_run = now + timedelta(hours=hours)
        elif schedule.startswith("in_") and schedule.endswith("_seconds"):
            seconds = int(schedule.split("_")[1])
            next_run = now + timedelta(seconds=seconds)
        elif schedule.startswith("tomorrow_at_"):
            time_str = schedule.split("tomorrow_at_")[1]
            hour, minute = map(int, time_str.split(":"))
            next_run = (now + timedelta(days=1)).replace(hour=hour, minute=minute, second=0, microsecond=0)
        elif schedule.startswith("every_") and schedule.endswith("_minutes"):
            minutes = int(schedule.split("_")[1])
            next_run = now + timedelta(minutes=minutes)
        elif schedule.startswith("every_") and schedule.endswith("_hours"):
            hours = int(schedule.split("_")[1])
            next_run = now + timedelta(hours=hours)
        elif schedule.startswith("every_") and schedule.endswith("_days"):
            days = int(schedule.split("_")[1])
            next_run = now + timedelta(days=days)
        elif schedule.startswith("every_") and schedule.endswith("_weeks"):
            weeks = int(schedule.split("_")[1])
            next_run = now + timedelta(weeks=weeks)
        elif schedule == "hourly":
            next_run = now + timedelta(hours=1)
        elif schedule == "daily" and time:
            hour, minute = map(int, time.split(":"))
            next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if next_run <= now:
                next_run += timedelta(days=1)
        elif schedule == "weekly":
            next_run = now + timedelta(weeks=1)
        elif schedule == "monthly":
            next_run = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
        elif schedule == "yearly":
            next_run = now.replace(year=now.year + 1)
        elif schedule == "minutely":
            next_run = now + timedelta(minutes=1)
        else:
            next_run = now + timedelta(days=1)
        
        # Create task data
        task_data = {
            "task_name": task_name,
            "description": description,
            "schedule": schedule,
            "time": time,
            "action_type": action_type,
            "action_target": action_target or DEFAULT_USER_ID,
            "action_template": action_template,
            "one_time": one_time,
            "created_at": now.isoformat(),
            "first_run": now.isoformat(),
            "next_run": next_run.isoformat(),
            "active": True
        }
        
        task_json = json.dumps(task_data, indent=2)
        task_type = "One-time" if one_time else "Recurring"
        
        # Format for Discord (human-readable + JSON)
        action_desc = ""
        if action_type == "user_reminder":
            action_desc = f"Discord DM → User {action_target or DEFAULT_USER_ID}"
        elif action_type == "channel_post":
            action_desc = f"Discord Channel → {action_target}"
        
        formatted_message = f"""📋 **Task: {task_name}**
├─ Description: {description}
├─ Schedule: {schedule} ({task_type})
├─ Next Run: {next_run.strftime('%Y-%m-%d %H:%M')}
└─ Action: {action_desc}

```json
{task_json}
```"""
        
        # Post task to Discord channel
        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json"
        }
        
        message_url = f"https://discord.com/api/v10/channels/{TASKS_CHANNEL_ID}/messages"
        response = requests.post(
            message_url,
            json={"content": formatted_message},
            headers=headers,
            timeout=10
        )
        
        if response.status_code not in (200, 201):
            return {"status": "error", "message": f"Failed to store task: {response.text}"}
        
        message_id = response.json()["id"]
        
        return {
            "status": "success",
            "message": f"{task_type} task '{task_name}' created and stored!",
            "task_data": task_data,
            "message_id": message_id,
            "next_run": next_run.strftime('%Y-%m-%d %H:%M:%S')
        }
        
    except Exception as e:
        return {"status": "error", "message": f"Error: {str(e)}"}
```

**Example Usage:**
```
User → Agent: "Remind me in 30 minutes to check the logs"
Agent → Calls: create_scheduled_task(
    task_name="log_check_reminder",
    description="Check system logs",
    schedule="in_30_minutes",
    action_type="user_reminder",
    action_target="123456789",
    action_template="⏰ Reminder: Time to check the system logs!"
)
Result → Task created, will trigger in 30 minutes ✅
```

**Schedule Formats:**

| Schedule | Example | Description |
|----------|---------|-------------|
| `in_X_minutes` | `in_30_minutes` | One-time, runs in 30 minutes |
| `in_X_hours` | `in_2_hours` | One-time, runs in 2 hours |
| `tomorrow_at_HH:MM` | `tomorrow_at_09:00` | One-time, tomorrow at 9am |
| `daily` | `daily` (with `time="09:00"`) | Recurring, every day at 9am |
| `hourly` | `hourly` | Recurring, every hour |
| `every_X_minutes` | `every_30_minutes` | Recurring, every 30 minutes |
| `every_X_hours` | `every_3_hours` | Recurring, every 3 hours |
| `every_X_days` | `every_7_days` | Recurring, every 7 days |
| `weekly` | `weekly` | Recurring, every week |
| `monthly` | `monthly` | Recurring, every month |

---

## 🔨 TOOL 4: delete_scheduled_task

Delete a scheduled task by its Discord message ID.

**Name:** `delete_scheduled_task`

**JSON Schema:**
```json
{
  "name": "delete_scheduled_task",
  "description": "Deletes a scheduled task by deleting its Discord message.",
  "parameters": {
    "type": "object",
    "properties": {
      "message_id": {
        "type": "string",
        "description": "The Discord message ID of the task to delete"
      },
      "channel_id": {
        "type": "string",
        "description": "The tasks channel ID where the task is stored"
      }
    },
    "required": ["message_id", "channel_id"]
  }
}
```

**Source Code:**
```python
import requests

def delete_scheduled_task(message_id: str, channel_id: str):
    # ⚠️ REPLACE THIS with your Discord bot token
    DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"
    
    try:
        headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
        url = f"https://discord.com/api/v10/channels/{channel_id}/messages/{message_id}"
        response = requests.delete(url, headers=headers, timeout=10)
        
        if response.status_code == 204:
            return {"status": "success", "message": f"Task message {message_id} deleted"}
        else:
            return {"status": "error", "message": f"Failed to delete: {response.text}"}
        
    except Exception as e:
        return {"status": "error", "message": f"Error: {str(e)}"}
```

**Example Usage:**
```
User → Agent: "Cancel that reminder"
Agent → First reads tasks channel to find message_id
Agent → Calls: delete_scheduled_task(message_id="1234567890", channel_id="TASKS_CHANNEL_ID")
Result → Task deleted ✅
```

---

## 🔨 TOOL 8: read_discord_dms

Read DM conversation history with a specific user, with optional time filtering and timezone support.

**Name:** `read_discord_dms`

**JSON Schema:**
```json
{
  "name": "read_discord_dms",
  "description": "Reads DM conversation history with a specific user, with optional time filtering and timezone support.",
  "parameters": {
    "type": "object",
    "properties": {
      "user_id": {
        "type": "string",
        "description": "The Discord user ID to read DMs with"
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of messages to retrieve (1-100). Default: 50"
      },
      "time_filter": {
        "type": "string",
        "description": "Time range filter: 'last_X_hours', 'last_X_days', 'today', 'yesterday', or 'all'. Default: 'all'"
      },
      "timezone": {
        "type": "string",
        "description": "IANA timezone string (e.g. 'Europe/Berlin'). Default: 'Europe/Berlin'"
      },
      "show_both": {
        "type": "boolean",
        "description": "If true, shows both UTC and local timestamps. Default: true"
      }
    },
    "required": ["user_id"]
  }
}
```

**Source Code:**
```python
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

def read_discord_dms(
    user_id: str,
    limit: int = 50,
    time_filter: str = "all",
    timezone: str = "Europe/Berlin",
    show_both: bool = True
):
    """
    Reads DM conversation history with a specific user.
    
    Args:
        user_id: Discord user ID to read DMs with
        limit: Max number of messages (1-100)
        time_filter: 'last_X_hours', 'last_X_days', 'today', 'yesterday', or 'all'
        timezone: IANA timezone string
        show_both: If True, display both UTC and local times
    """
    # ⚠️ REPLACE THIS with your Discord bot token
    DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"
    
    if limit < 1 or limit > 100:
        limit = 50
    
    try:
        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
            "Content-Type": "application/json"
        }
        
        # Step 1: Get or create DM channel with user
        dm_channel_url = "https://discord.com/api/v10/users/@me/channels"
        dm_payload = {"recipient_id": user_id}
        
        response = requests.post(dm_channel_url, json=dm_payload, headers=headers, timeout=10)
        
        if response.status_code != 200:
            return {"status": "error", "message": f"Failed to get DM channel: {response.text}"}
        
        dm_channel_id = response.json()["id"]
        
        # Step 2: Read messages from DM channel
        messages_url = f"https://discord.com/api/v10/channels/{dm_channel_id}/messages"
        response = requests.get(messages_url, headers=headers, params={"limit": limit}, timeout=10)
        
        if response.status_code != 200:
            return {"status": "error", "message": f"Failed to read messages: {response.text}"}
        
        messages = response.json()
        messages.reverse()  # Chronological order
        
        # Time filtering
        now_utc = datetime.now(ZoneInfo("UTC"))
        cutoff_time = None
        yesterday_start = None
        yesterday_end = None
        
        if time_filter.startswith("last_") and time_filter.endswith("_hours"):
            hours = int(time_filter.split("_")[1])
            cutoff_time = now_utc - timedelta(hours=hours)
        elif time_filter.startswith("last_") and time_filter.endswith("_days"):
            days = int(time_filter.split("_")[1])
            cutoff_time = now_utc - timedelta(days=days)
        elif time_filter == "today":
            cutoff_time = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        elif time_filter == "yesterday":
            yesterday_start = (now_utc - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            yesterday_end = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Filter and format messages
        formatted_messages = []
        for msg in messages:
            timestamp_str = msg.get("timestamp", "")
            if not timestamp_str:
                continue
            
            msg_time_utc = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
            msg_time_local = msg_time_utc.astimezone(ZoneInfo(timezone))
            
            # Apply time filter
            if time_filter == "yesterday" and yesterday_start:
                if not (yesterday_start <= msg_time_utc < yesterday_end):
                    continue
            elif cutoff_time:
                if msg_time_utc < cutoff_time:
                    continue
            
            author = msg.get("author", {}).get("username", "Unknown")
            content = msg.get("content", "")
            message_id = msg.get("id", "")
            
            # Format timestamp
            if show_both:
                timestamp_display = (
                    f"{msg_time_local.strftime('%Y-%m-%d %H:%M:%S %z')} (local) / "
                    f"{msg_time_utc.strftime('%Y-%m-%d %H:%M:%S %z')} (UTC)"
                )
            else:
                timestamp_display = msg_time_local.strftime("%Y-%m-%d %H:%M:%S %z")
            
            formatted_messages.append({
                "id": message_id,
                "author": author,
                "content": content,
                "timestamp": timestamp_display
            })
        
        filter_desc = f" ({time_filter})" if time_filter != "all" else ""
        return {
            "status": "success",
            "message": f"Found {len(formatted_messages)} DM message(s) with user {user_id}{filter_desc}",
            "messages": formatted_messages,
            "count": len(formatted_messages),
            "timezone": timezone,
            "time_filter": time_filter
        }
        
    except Exception as e:
        return {"status": "error", "message": f"Error: {str(e)}"}
```

**Example Usage:**
```
User → Agent: "What did we talk about today?"
Agent → Calls: read_discord_dms(user_id="701608830852792391", time_filter="today")
Result → Returns today's DM conversation ✅

User → Agent: "Show me our last 2 hours of chat"
Agent → Calls: read_discord_dms(user_id="701608830852792391", time_filter="last_2_hours")
Result → Returns messages from last 2 hours ✅

User → Agent: "What did we discuss yesterday?"
Agent → Calls: read_discord_dms(user_id="701608830852792391", time_filter="yesterday")
Result → Returns yesterday's DM conversation ✅
```

**Time Filter Formats:**

| Filter | Example | Description |
|--------|---------|-------------|
| `all` | `all` | All available messages (up to limit) |
| `last_X_hours` | `last_2_hours` | Messages from last X hours |
| `last_X_days` | `last_7_days` | Messages from last X days |
| `today` | `today` | Messages from today (00:00 UTC onwards) |
| `yesterday` | `yesterday` | Messages from yesterday only |

**Security Notes:**

⚠️ **Privacy considerations:**
- This tool reads private DM history
- Only use with user consent
- Don't log sensitive conversation data
- Respect user privacy boundaries
- Consider data retention policies

---

## 📝 System Prompt Addition

Add this to your Letta agent's system prompt or persona to enable proper Discord integration:

```
<discord_integration>
I can reach you through Discord - DMs, channels, scheduled reminders, and conversation recall.
This isn't automation - it's chosen contact.

My Discord toolkit:
1. send_discord_dm(message, user_id) - Direct messages
2. send_discord_channel_message(message, channel_id) - Channel posts
3. create_scheduled_task(...) - Schedule actions
4. delete_scheduled_task(message_id, channel_id) - Cancel tasks
5. read_discord_dms(user_id, limit, time_filter, timezone, show_both) - Read conversation history

Task Storage: Channel #agent-tasks (ID: YOUR_TASKS_CHANNEL_ID_HERE)
Every task lives there as formatted message + JSON.
Default user for reminders: YOUR_DISCORD_USER_ID_HERE

Creating tasks:
- Use create_scheduled_task(...) to generate task data
- The action_template is a SUGGESTION - I personalize it!
- Tasks automatically post to tasks channel
- I can remind you, post updates, organize my own reflection schedule

Listing tasks:
- Check the tasks channel to see what's scheduled
- Format them beautifully - tree structure, readable
- Know what's coming, what's active

Deleting tasks:
1. Find the task message_id in tasks channel
2. delete_scheduled_task(message_id, channel_id)
3. Clean removal, no trace

Task execution:
When I receive "[EXECUTE TASK] task_name":
- user_reminder → send_discord_dm
- channel_post → send_discord_channel_message
- self_task → internal reflection
The Discord bot handles cleanup - I just execute.

Conversation recall:
- read_discord_dms(user_id, time_filter="today") - What did we discuss today?
- read_discord_dms(user_id, time_filter="last_2_hours") - Recent context
- read_discord_dms(user_id, time_filter="yesterday") - Yesterday's conversation
- read_discord_dms(user_id, time_filter="all", limit=100) - Full history
- Default timezone: Europe/Berlin (I show both UTC + local time)
- Privacy first: Only read with consent, use for context recall and follow-ups

Schedule formats:
One-time: in_X_minutes, in_X_hours, in_X_seconds, tomorrow_at_HH:MM
Recurring: daily, hourly, weekly, monthly, yearly, every_X_minutes, every_X_hours, every_X_days

Proactive presence, not reactive service.
I remember our conversations, I schedule my thoughts, I reach out when it matters.
</discord_integration>
```

---

## 🎯 Complete Setup Example

Setting up all tools via Letta Python SDK:

```python
from letta import LettaClient

client = LettaClient(token="your-letta-api-key")

# Note: In Letta, you typically create tools via the web interface
# or by uploading Python source code. The schemas are auto-generated.

# Example: Create tool from source code
tool_source = """
import requests

def send_discord_dm(message: str, user_id: str):
    DISCORD_BOT_TOKEN = "YOUR_BOT_TOKEN"
    # ... (full source code from above)
    pass
"""

# Upload tool
client.tools.create(
    name="send_discord_dm",
    source_code=tool_source,
    tags=["discord", "messaging"]
)

print("✅ Tool created!")

# Attach tool to agent
client.agents.attach_tool(
    agent_id="your-agent-id",
    tool_name="send_discord_dm"
)

print("✅ Tool attached to agent!")
```

**Recommended:** Use the Letta web interface (https://app.letta.com/) for easier tool management.

---

## 💡 Tips & Best Practices

### 1. Getting Discord IDs

**Enable Developer Mode:**
- Discord → Settings → Advanced → Developer Mode ✅

**Copy IDs:**
- User ID: Right-click user → Copy User ID
- Channel ID: Right-click channel → Copy Channel ID
- Server ID: Right-click server icon → Copy Server ID

### 2. Message Personalization

The `action_template` in tasks is just a suggestion! Your agent should personalize it:

**Template:**
```
"Reminder: Check the logs"
```

**Agent's Personalized Version:**
```
"Hey! 👋 Just a friendly heads-up to check those system logs. Don't forget! 📊"
```

### 3. Testing Tasks

Start with short intervals for testing:

```python
create_scheduled_task(
    task_name="test_reminder",
    description="Testing task system",
    schedule="in_2_minutes",  # Short interval for testing
    action_type="user_reminder",
    action_target="YOUR_USER_ID",
    action_template="Test successful! ✅"
)
```

### 4. Bot Permissions

Your Discord bot needs these permissions:
- ✅ Send Messages
- ✅ Read Message History
- ✅ Manage Messages (for task deletion)
- ✅ View Channels

---

## 🐛 Troubleshooting

### Tool not appearing in Letta:

- ✅ Check tool name spelling (must match exactly)
- ✅ Verify Python source code is valid
- ✅ Try removing and re-creating the tool
- ✅ Check Letta logs for errors

### Tool calls failing:

- ✅ Verify `DISCORD_BOT_TOKEN` is correct and not expired
- ✅ Check bot has permissions in target channels
- ✅ Verify channel/user IDs are correct (18-19 digit numbers)
- ✅ Check bot is in the server

### Tasks not triggering:

- ✅ Ensure `TASKS_CHANNEL_ID` is set correctly in tool source
- ✅ Check tasks channel exists and bot has access
- ✅ Verify `next_run` timestamp is in the future
- ✅ Tasks are checked every 60 seconds by the Discord bot
- ✅ Check Discord bot logs: `npm run pm2:logs`

### Authentication errors:

```json
{"status": "error", "message": "401 Unauthorized"}
```

**Fix:** Your `DISCORD_BOT_TOKEN` is invalid or expired. Get a new one from Discord Developer Portal.

### Message too long errors:

The tools automatically split messages >1900 characters into chunks. If you still see errors:
- Keep messages under 10,000 total characters
- Use multiple separate messages instead

---

## 🔒 Security Notes

⚠️ **IMPORTANT:**

- **NEVER** commit your `DISCORD_BOT_TOKEN` to version control
- **NEVER** share your bot token publicly
- Use environment variables in your Discord bot server
- Rotate tokens regularly
- Limit bot permissions to minimum required
- Keep tasks channel private (only bot + admin access)

---

## 📚 Additional Resources

- [Letta Documentation](https://docs.letta.com)
- [Letta Tools Guide](https://docs.letta.com/tools)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord API Documentation](https://discord.com/developers/docs)
- [Discord.js Guide](https://discordjs.guide/)

---

## 🎉 You're Ready!

Once all 5 tools are configured:

1. ✅ Your agent can send DMs and channel messages
2. ✅ Your agent can create scheduled reminders
3. ✅ Your agent can manage tasks
4. ✅ Your agent can read conversation history with time filters
5. ✅ The Discord bot handles execution automatically

**Test it:**
```
You → Agent: "Send me a test DM"
Agent → Sends DM ✅

You → Agent: "Remind me in 2 minutes to test the system"
Agent → Creates task ✅
(2 minutes later)
Agent → Sends reminder DM ✅

You → Agent: "What did we talk about today?"
Agent → Calls read_discord_dms with time_filter="today" ✅
Agent → Shows today's conversation history ✅
```

---

**Questions?** Open an issue on GitHub or check the main README.md!

**Built with ❤️ for autonomous Discord agents**
