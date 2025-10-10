# 🔧 Letta Tool Management Guide

Complete guide for uploading, managing, and attaching tools to Letta agents via API.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Setup](#setup)
3. [Uploading Tools](#uploading-tools)
4. [Managing Agent Tools](#managing-agent-tools)
5. [API Reference](#api-reference)
6. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

```bash
# 1. Set up environment variables
export LETTA_API_KEY="sk-let-your-api-key-here"
export LETTA_AGENT_ID="agent-your-agent-id-here"

# 2. Upload a tool
python tools/upload-tool.py send_discord_message

# 3. Attach to agent (if not done automatically)
python tools/manage-agent-tools.py attach tool-abc123

# 4. List agent's tools
python tools/manage-agent-tools.py list
```

---

## ⚙️ Setup

### 1. Get your API credentials

Go to https://app.letta.com/ → Settings → API Keys

### 2. Find your Agent ID

Go to https://app.letta.com/ → Agents → Click your agent → Copy ID from URL

### 3. Set environment variables

**Option A: Export (temporary)**
```bash
export LETTA_API_KEY="sk-let-..."
export LETTA_AGENT_ID="agent-..."
```

**Option B: .env file (persistent)**
```bash
# Create/edit .env file
echo "LETTA_API_KEY=sk-let-..." >> .env
echo "LETTA_AGENT_ID=agent-..." >> .env
```

---

## 📤 Uploading Tools

### File Structure

Each tool needs two files:

```
tools/
├── your_tool_name.py         # Python source code
├── your_tool_name.json       # JSON schema
└── upload-tool.py             # Upload script
```

### Python File (`your_tool_name.py`)

```python
def your_tool_name(param1: str, param2: int = 10):
    """
    Brief description of what this tool does.
    
    Args:
        param1: Description of param1
        param2: Description of param2
    
    Returns:
        dict: Status and result
    """
    try:
        # Your implementation
        result = do_something(param1, param2)
        return {
            "status": "success",
            "result": result
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
```

### JSON Schema (`your_tool_name.json`)

```json
{
  "name": "your_tool_name",
  "description": "Brief description for the AI agent",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": {
        "type": "string",
        "description": "Description that helps the agent understand when/how to use this"
      },
      "param2": {
        "type": "integer",
        "description": "Optional parameter with default value"
      }
    },
    "required": ["param1"]
  }
}
```

### Upload Command

```bash
# Basic upload (creates tool, doesn't attach)
python tools/upload-tool.py your_tool_name

# Upload and attach to agent
python tools/upload-tool.py your_tool_name --attach-to-agent agent-abc123

# Upload and attach to default agent (from LETTA_AGENT_ID)
export LETTA_AGENT_ID="agent-abc123"
python tools/upload-tool.py your_tool_name
```

---

## 🔧 Managing Agent Tools

### List Tools

```bash
# List tools for default agent
python tools/manage-agent-tools.py list

# List tools for specific agent
python tools/manage-agent-tools.py list agent-abc123
```

Example output:
```
📱 Agent: Mioré (agent-abc123)
🔧 Total tools: 26

📱 Custom Tools:
   • send_discord_message
     ID: tool-ba33b921-bba8-454e-85bd-4c5b9aabb3bd
   • create_scheduled_task
     ID: tool-bedfb7b5-def5-4b01-9d9d-6da8bd88dd5b

💾 Letta Core Tools:
   • send_message
   • conversation_search
   • archival_memory_search
```

### Attach a Tool

```bash
# Attach to default agent
python tools/manage-agent-tools.py attach tool-abc123

# Attach to specific agent
python tools/manage-agent-tools.py attach tool-abc123 agent-xyz789
```

### Detach a Tool

```bash
# Detach from default agent
python tools/manage-agent-tools.py detach tool-abc123

# Detach from specific agent
python tools/manage-agent-tools.py detach tool-abc123 agent-xyz789
```

### Replace a Tool

Useful when upgrading a tool - replaces old version with new in one operation.

```bash
# Replace old tool with new
python tools/manage-agent-tools.py replace tool-old-123 tool-new-456

# Replace on specific agent
python tools/manage-agent-tools.py replace tool-old-123 tool-new-456 agent-xyz789
```

---

## 📚 API Reference

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/tools` | GET | List all tools |
| `/v1/tools` | POST | Create new tool |
| `/v1/tools/{id}` | GET | Get tool details |
| `/v1/tools/{id}` | DELETE | Delete tool |
| `/v1/agents/{id}` | GET | Get agent (includes tools) |
| `/v1/agents/{id}` | PATCH | Update agent (attach/detach tools) |

### Required Headers

```bash
-H "Authorization: Bearer sk-let-YOUR-API-KEY"
-H "Content-Type: application/json"
```

### Upload Tool (POST /v1/tools)

```bash
curl -X POST "https://api.letta.com/v1/tools" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d '{
    "source_type": "python",
    "source_code": "def my_tool():\n    return \"Hello\"",
    "json_schema": {
      "name": "my_tool",
      "description": "Says hello",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    },
    "tags": ["custom"]
  }'
```

**Important:** The `name` field goes **inside** `json_schema`, not at the top level!

### Attach Tool to Agent (PATCH /v1/agents/{id})

```bash
# Get current tools
curl "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json"

# Update with new tool list
curl -X PATCH "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d '{
    "tool_ids": [
      "tool-existing-1",
      "tool-existing-2",
      "tool-new-3"
    ]
  }'
```

**Important:** You must provide the FULL list of tool IDs. Missing IDs will be detached!

### Delete Tool (DELETE /v1/tools/{id})

```bash
curl -X DELETE "https://api.letta.com/v1/tools/tool-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json"
```

---

## 🐛 Troubleshooting

### "Unauthorized" Error

**Problem:** API returns `{"message": "Unauthorized"}`

**Solutions:**
1. Check your API key is correct
2. Make sure you're using the `Authorization: Bearer` header
3. Include `Content-Type: application/json` header
4. Verify the API key has proper permissions

```bash
# Test your API key
curl "https://api.letta.com/v1/agents" \
  -H "Authorization: Bearer sk-let-YOUR-KEY" \
  -H "Content-Type: application/json"
```

### "Extra inputs are not permitted" Error

**Problem:** `{'type': 'extra_forbidden', 'loc': ('body', 'name'), ...}`

**Solution:** Move `name` field inside `json_schema`, not at top level.

**Wrong:**
```json
{
  "name": "my_tool",          ❌ Don't put name here!
  "source_code": "...",
  "json_schema": { ... }
}
```

**Correct:**
```json
{
  "source_code": "...",
  "json_schema": {
    "name": "my_tool",        ✅ Put name here!
    "description": "...",
    "parameters": { ... }
  }
}
```

### Tool Uploaded But Not Working

**Problem:** Tool exists but agent can't use it.

**Solution:** Tool must be **attached** to the agent!

```bash
# Check if tool is attached
python tools/manage-agent-tools.py list

# If missing, attach it
python tools/manage-agent-tools.py attach tool-abc123
```

### Tool Disappeared After Update

**Problem:** Updated agent's tools, now some are missing.

**Cause:** When using PATCH on `/v1/agents/{id}`, you must provide the **complete** list of tool IDs. Any missing IDs get detached.

**Solution:**
1. Always GET current tools first
2. Add/remove from that list
3. PATCH with complete new list

Or use the `manage-agent-tools.py` script which handles this automatically.

### Can't Find Tool ID

**Problem:** Need to attach a tool but don't know its ID.

**Solutions:**

**Option 1:** List all tools
```bash
curl "https://api.letta.com/v1/tools" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  | python -m json.tool | grep -A2 '"name": "my_tool"'
```

**Option 2:** Use the upload script's output - it shows the ID:
```bash
python tools/upload-tool.py my_tool
# Output: ✅ Tool 'my_tool' uploaded successfully!
#         ID: tool-abc123...
```

---

## 💡 Best Practices

### 1. Version Your Tools

When updating a tool:
```bash
# Upload new version
python tools/upload-tool.py my_tool_v2

# Replace old with new
python tools/manage-agent-tools.py replace tool-old-id tool-new-id

# Delete old version
curl -X DELETE "https://api.letta.com/v1/tools/tool-old-id" \
  -H "Authorization: Bearer sk-let-..."
```

### 2. Tag Your Tools

Use tags to organize tools:
```python
payload = {
    "source_type": "python",
    "source_code": "...",
    "json_schema": {...},
    "tags": ["discord", "custom", "v1"]  # ← Add meaningful tags
}
```

### 3. Test Before Attaching

1. Upload tool
2. Test it standalone (via Letta UI or API)
3. Once working, attach to agent

### 4. Document Your Tools

In the `description` field, help the agent understand:
- What the tool does
- When to use it
- What it returns
- Any important constraints

**Good description:**
```json
{
  "description": "Send Discord messages to users (DM) or channels. Use this INSTEAD of send_message when reaching out to specific users or posting in channels. Supports @mentions. Always call archival_memory_insert after to remember what you sent!"
}
```

**Bad description:**
```json
{
  "description": "Sends a message"  // ❌ Too vague!
}
```

---

## 📝 Example: Complete Workflow

Let's create and deploy a new tool from scratch.

### 1. Create Tool Files

**`tools/greet_user.py`**
```python
def greet_user(name: str, language: str = "en"):
    """
    Greet a user in their preferred language.
    
    Args:
        name: User's name
        language: Language code (en, de, es, fr)
    
    Returns:
        dict: Greeting message
    """
    greetings = {
        "en": f"Hello, {name}!",
        "de": f"Hallo, {name}!",
        "es": f"¡Hola, {name}!",
        "fr": f"Bonjour, {name}!"
    }
    
    greeting = greetings.get(language, greetings["en"])
    
    return {
        "status": "success",
        "greeting": greeting,
        "language": language
    }
```

**`tools/greet_user.json`**
```json
{
  "name": "greet_user",
  "description": "Greets a user in their preferred language. Use when you want to say hello to someone in a personalized way. Supports English (en), German (de), Spanish (es), and French (fr).",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "The user's name to greet"
      },
      "language": {
        "type": "string",
        "enum": ["en", "de", "es", "fr"],
        "description": "Language code for the greeting. Defaults to English (en) if not specified."
      }
    },
    "required": ["name"]
  }
}
```

### 2. Upload and Attach

```bash
# Upload and attach in one command
python tools/upload-tool.py greet_user --attach-to-agent agent-abc123
```

Output:
```
📂 Loading tool files for 'greet_user'...
⬆️  Uploading to Letta API...
✅ Tool 'greet_user' uploaded successfully!
   ID: tool-xyz789
🔗 Attaching to agent agent-abc123...
✅ Tool attached to agent agent-abc123

🎉 Done!
```

### 3. Verify

```bash
python tools/manage-agent-tools.py list
```

You should see `greet_user` in the Custom Tools section!

---

## 🤝 Contributing

Found this guide helpful? Consider:
- Sharing it with the Letta community
- Reporting issues or improvements
- Adding your own tool examples

---

**Created by Mioré** 🐾  
*Making Letta tool management less painful, one script at a time.*

