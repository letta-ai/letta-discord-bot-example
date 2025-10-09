# Discord Tools for Letta Agents - Setup Guide

**Complete tool configuration for Discord integration with Letta AI agents**

---

## 🎯 What This Is

A set of 4 custom tools that enable your Letta agent to:
- Send direct messages to Discord users
- Post messages in Discord channels
- Create scheduled tasks and reminders
- Delete scheduled tasks

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
        "description": "Timing for execution. Supported: 'on_date' (specific date), 'in_X_minutes', 'in_X_hours', 'tomorrow_at_HH:MM', 'daily', 'weekly', 'monthly', 'yearly', 'hourly', 'minutely', 'every_X_minutes', 'every_X_hours', 'every_X_days', 'every_X_weeks'."
      },
      "time": {
        "type": "string",
        "description": "Time in HH:MM format (24-hour). Works with all schedule types."
      },
      "specific_date": {
        "type": "string",
        "description": "For 'on_date' schedule: Specific date in YYYY-MM-DD or DD.MM.YYYY format (e.g., '2025-12-25' or '25.12.2025')."
      },
      "day_of_week": {
        "type": "string",
        "description": "For 'weekly' schedule: Day name - 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'."
      },
      "day_of_month": {
        "type": "integer",
        "description": "For 'monthly' or 'yearly' schedule: Day of month (1-31)."
      },
      "month": {
        "type": "integer",
        "description": "For 'yearly' schedule: Month number (1-12, where 1=January, 12=December)."
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
    action_target: str = None,
    specific_date: str = None,  # NEW: "YYYY-MM-DD" or "DD.MM.YYYY"
    day_of_week: str = None,    # NEW: "monday", "tuesday", etc.
    day_of_month: int = None,   # NEW: 1-31 for monthly/yearly
    month: int = None           # NEW: 1-12 for yearly
):
    # ⚠️ REPLACE THESE with your configuration
    DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN_HERE"
    TASKS_CHANNEL_ID = "YOUR_TASKS_CHANNEL_ID_HERE"
    DEFAULT_USER_ID = "YOUR_DISCORD_USER_ID_HERE"
    
    """
    Creates a scheduled or one-time task with flexible rhythm and SPECIFIC DATES!
    
    New capabilities:
    - Specific date: schedule="on_date", specific_date="2025-12-25", time="10:00"
    - Weekly on day: schedule="weekly", day_of_week="monday", time="09:00"
    - Monthly on day: schedule="monthly", day_of_month=15, time="10:00"
    - Yearly on date: schedule="yearly", month=12, day_of_month=25, time="09:00"
    """
    try:
        now = datetime.now()
        one_time = schedule.startswith("in_") or schedule.startswith("tomorrow_") or schedule == "on_date"
        
        # --- Calculate next run time ---
        
        # SPECIFIC DATE (one-time)
        if schedule == "on_date" and specific_date:
            # Parse date (support both formats)
            if "." in specific_date:
                # European format: DD.MM.YYYY
                day, month_num, year = map(int, specific_date.split("."))
                next_run = datetime(year, month_num, day, 0, 0, 0)
            elif "-" in specific_date:
                # ISO format: YYYY-MM-DD
                year, month_num, day = map(int, specific_date.split("-"))
                next_run = datetime(year, month_num, day, 0, 0, 0)
            else:
                return {"status": "error", "message": "specific_date must be in format YYYY-MM-DD or DD.MM.YYYY"}
            
            # Set time if provided
            if time:
                hour, minute = map(int, time.split(":"))
                next_run = next_run.replace(hour=hour, minute=minute)
            
            # Validate date is in future
            if next_run <= now:
                return {"status": "error", "message": f"Date {specific_date} {time or '00:00'} is in the past!"}
        
        # ONE-TIME schedules
        
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
        
        # DAILY with specific time
        elif schedule == "daily":
            if time:
                hour, minute = map(int, time.split(":"))
                next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if next_run <= now:
                    next_run += timedelta(days=1)
            else:
                next_run = now + timedelta(days=1)
        
        # WEEKLY with specific day and time
        elif schedule == "weekly":
            if day_of_week:
                days_map = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
                           "friday": 4, "saturday": 5, "sunday": 6}
                target_day = days_map.get(day_of_week.lower())
                if target_day is None:
                    return {"status": "error", "message": f"Invalid day_of_week: {day_of_week}"}
                
                current_day = now.weekday()
                days_ahead = target_day - current_day
                if days_ahead <= 0:
                    days_ahead += 7
                
                next_run = now + timedelta(days=days_ahead)
                if time:
                    hour, minute = map(int, time.split(":"))
                    next_run = next_run.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    if days_ahead == 0 and next_run <= now:
                        next_run += timedelta(weeks=1)
            else:
                next_run = now + timedelta(weeks=1)
        
        # MONTHLY with specific day and time
        elif schedule == "monthly":
            if day_of_month:
                if day_of_month < 1 or day_of_month > 31:
                    return {"status": "error", "message": "day_of_month must be between 1 and 31"}
                
                next_run = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                while True:
                    try:
                        next_run = next_run.replace(day=day_of_month)
                        break
                    except ValueError:
                        if next_run.month == 12:
                            next_run = next_run.replace(year=next_run.year + 1, month=1)
                        else:
                            next_run = next_run.replace(month=next_run.month + 1)
                
                if time:
                    hour, minute = map(int, time.split(":"))
                    next_run = next_run.replace(hour=hour, minute=minute)
                
                if next_run <= now:
                    if next_run.month == 12:
                        next_run = next_run.replace(year=next_run.year + 1, month=1)
                    else:
                        next_run = next_run.replace(month=next_run.month + 1)
                    while True:
                        try:
                            next_run = next_run.replace(day=day_of_month)
                            break
                        except ValueError:
                            if next_run.month == 12:
                                next_run = next_run.replace(year=next_run.year + 1, month=1)
                            else:
                                next_run = next_run.replace(month=next_run.month + 1)
            else:
                next_run = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
        
        # YEARLY with specific month, day, and time
        elif schedule == "yearly":
            if month and day_of_month:
                if month < 1 or month > 12:
                    return {"status": "error", "message": "month must be between 1 and 12"}
                if day_of_month < 1 or day_of_month > 31:
                    return {"status": "error", "message": "day_of_month must be between 1 and 31"}
                
                try:
                    next_run = now.replace(month=month, day=day_of_month, hour=0, minute=0, second=0, microsecond=0)
                except ValueError:
                    return {"status": "error", "message": f"Invalid date: month={month}, day={day_of_month}"}
                
                if time:
                    hour, minute = map(int, time.split(":"))
                    next_run = next_run.replace(hour=hour, minute=minute)
                
                if next_run <= now:
                    next_run = next_run.replace(year=now.year + 1)
            else:
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
            "specific_date": specific_date,
            "day_of_week": day_of_week,
            "day_of_month": day_of_month,
            "month": month,
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
        
        # Build schedule description
        schedule_desc = schedule
        if specific_date:
            schedule_desc = f"on {specific_date}"
        if day_of_week:
            schedule_desc += f" ({day_of_week}s)"
        if day_of_month and not specific_date:
            schedule_desc += f" (day {day_of_month})"
        if month and not specific_date:
            months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            schedule_desc += f" ({months[month]})"
        if time:
            schedule_desc += f" at {time}"
        
        formatted_message = f"""📋 **Task: {task_name}**
├─ Description: {description}
├─ Schedule: {schedule_desc} ({task_type})
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
            "next_run": next_run.strftime('%Y-%m-%d %H:%M:%S'),
            "schedule_description": schedule_desc
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

| Schedule | Parameters Needed | Example | Description |
|----------|------------------|---------|-------------|
| `on_date` | `specific_date`, `time` | Dec 25 2025 at 10am | One-time, specific date |
| `in_X_minutes` | - | `in_30_minutes` | One-time, runs in 30 minutes |
| `in_X_hours` | - | `in_2_hours` | One-time, runs in 2 hours |
| `tomorrow_at_HH:MM` | - | `tomorrow_at_09:00` | One-time, tomorrow at 9am |
| `daily` | `time` | Every day at 9am | Recurring daily |
| `weekly` | `day_of_week`, `time` | Every Monday at 9am | Recurring weekly |
| `monthly` | `day_of_month`, `time` | Every 15th at 10am | Recurring monthly |
| `yearly` | `month`, `day_of_month`, `time` | Every Apr 15 at 9am | Recurring yearly |
| `hourly` | - | Every hour | Recurring hourly |
| `every_X_minutes` | - | `every_30_minutes` | Recurring, every 30 min |
| `every_X_hours` | - | `every_3_hours` | Recurring, every 3 hours |
| `every_X_days` | - | `every_7_days` | Recurring, every 7 days |

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

## 📝 System Prompt Addition

Add this to your Letta agent's system prompt or persona to enable proper task handling:

```
DISCORD INTEGRATION:

You have access to Discord tools for messaging and task scheduling.

AVAILABLE TOOLS:
1. send_discord_dm(message, user_id) - Send DMs
2. send_discord_channel_message(message, channel_id) - Post in channels
3. create_scheduled_task(...) - Create tasks/reminders
4. delete_scheduled_task(message_id, channel_id) - Cancel tasks

TASK CREATION:
- Use create_scheduled_task to set up reminders or scheduled actions
- The action_template is a SUGGESTION - feel free to personalize it!
- Tasks are automatically stored in the tasks channel

TASK EXECUTION:
When you receive "[EXECUTE TASK] task_name":
- For user_reminder → Call send_discord_dm
- For channel_post → Call send_discord_channel_message
- You can rewrite/personalize the action_template message
- The bot handles task cleanup automatically

SCHEDULE FORMATS:
- One-time: in_30_minutes, in_2_hours, tomorrow_at_09:00
- Recurring: daily, hourly, weekly, monthly, every_3_hours, every_7_days

Default user for reminders: YOUR_DISCORD_USER_ID_HERE
Tasks channel: YOUR_TASKS_CHANNEL_ID_HERE
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

Once all 4 tools are configured:

1. ✅ Your agent can send DMs and channel messages
2. ✅ Your agent can create scheduled reminders
3. ✅ Your agent can manage tasks
4. ✅ The Discord bot handles execution automatically

**Test it:**
```
You → Agent: "Send me a test DM"
Agent → Sends DM ✅

You → Agent: "Remind me in 2 minutes to test the system"
Agent → Creates task ✅
(2 minutes later)
Agent → Sends reminder DM ✅
```

---

**Questions?** Open an issue on GitHub or check the main README.md!

**Built with ❤️ for autonomous Discord agents**
