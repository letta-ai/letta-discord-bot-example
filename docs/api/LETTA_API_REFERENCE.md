# 🤖 Letta API Reference

Quick reference for Letta AI API - based on real-world usage and testing.

**Official Docs:** https://docs.letta.com/  
**API Base:** `https://api.letta.com/v1`  
**API Key:** Get from https://app.letta.com/ → Settings → API Keys

---

## 🔑 Authentication

All requests require:
```bash
-H "Authorization: Bearer sk-let-YOUR-API-KEY"
-H "Content-Type: application/json"  # ← CRITICAL! Without this you get errors!
```

---

## 📦 Tools API

### List All Tools

```bash
GET /v1/tools
```

```bash
curl "https://api.letta.com/v1/tools" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json"
```

**Response:**
```json
[
  {
    "id": "tool-abc123",
    "name": "my_tool",
    "description": "What this tool does",
    "tool_type": "custom",
    "source_type": "python",
    "source_code": "def my_tool():\n    return 'hello'",
    "json_schema": {...},
    "tags": ["custom"],
    "return_char_limit": 50000,
    "created_by_id": "user-xyz",
    "last_updated_by_id": "user-xyz",
    "metadata_": {}
  }
]
```

### Get Single Tool

```bash
GET /v1/tools/{tool_id}
```

```bash
curl "https://api.letta.com/v1/tools/tool-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json"
```

### Create Tool

```bash
POST /v1/tools
```

**⚠️ CRITICAL SCHEMA FORMAT:**

```json
{
  "source_type": "python",
  "source_code": "def my_tool(param: str):\n    return param",
  "description": "Optional top-level description",
  "tags": ["custom", "discord"],
  "json_schema": {
    "name": "my_tool",           // ← Name goes HERE, not top-level!
    "description": "Description for AI",
    "parameters": {
      "type": "object",
      "properties": {
        "param": {
          "type": "string",
          "description": "Parameter description"
        }
      },
      "required": ["param"]
    }
  }
}
```

**Common Mistake:**
```json
{
  "name": "my_tool",      // ❌ WRONG! This causes "extra_forbidden" error
  "json_schema": {...}
}
```

**Example:**
```bash
curl -X POST "https://api.letta.com/v1/tools" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d '{
    "source_type": "python",
    "source_code": "def greet(name: str):\n    return f\"Hello, {name}!\"",
    "tags": ["custom"],
    "json_schema": {
      "name": "greet",
      "description": "Greets a user by name",
      "parameters": {
        "type": "object",
        "properties": {
          "name": {"type": "string", "description": "User name"}
        },
        "required": ["name"]
      }
    }
  }'
```

**Response:**
```json
{
  "id": "tool-new123",
  "name": "greet",
  ...
}
```

### Delete Tool

```bash
DELETE /v1/tools/{tool_id}
```

```bash
curl -X DELETE "https://api.letta.com/v1/tools/tool-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json"
```

**Response:** `null` (status 200 = success)

---

## 🤖 Agents API

### Get Agent

```bash
GET /v1/agents/{agent_id}
```

```bash
curl "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "id": "agent-abc123",
  "name": "My Agent",
  "created_at": "2025-10-10T12:00:00Z",
  "tools": [
    {
      "id": "tool-xyz",
      "name": "send_message",
      "tool_type": "letta_core",
      ...
    }
  ],
  "tool_rules": [
    {
      "tool_name": "send_message",
      "type": "exit_loop",
      "prompt_template": null
    }
  ],
  ...
}
```

### Update Agent (Attach/Detach Tools)

```bash
PATCH /v1/agents/{agent_id}
```

**⚠️ CRITICAL:** You must provide the **COMPLETE** list of tool IDs. Missing tools will be detached!

**Workflow:**
1. GET current agent → extract current `tool_ids`
2. Add/remove tool IDs from list
3. PATCH with complete new list

```bash
# Step 1: Get current tools
curl "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  | python -c "import sys, json; data=json.load(sys.stdin); print(json.dumps([t['id'] for t in data['tools']]))"
```

Output: `["tool-1", "tool-2", "tool-3"]`

```bash
# Step 2: Add new tool
# ["tool-1", "tool-2", "tool-3", "tool-new"]

# Step 3: Update agent
curl -X PATCH "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d '{
    "tool_ids": [
      "tool-1",
      "tool-2",
      "tool-3",
      "tool-new"
    ]
  }'
```

**Other updatable fields:**
```json
{
  "name": "New Agent Name",
  "system": "Updated system prompt",
  "llm_config": {...},
  "tool_ids": [...]
}
```

---

## 💬 Messages API

### Send Message to Agent

```bash
POST /v1/agents/{agent_id}/messages
```

**Stream Response (recommended):**
```bash
curl -X POST "https://api.letta.com/v1/agents/agent-abc123/messages" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ],
    "stream_steps": true,
    "stream_tokens": true
  }'
```

**Non-stream Response:**
```bash
curl -X POST "https://api.letta.com/v1/agents/agent-abc123/messages" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ]
  }'
```

**Response:**
```json
{
  "messages": [
    {
      "id": "message-xyz",
      "role": "assistant",
      "content": "Hello! How can I help?",
      "created_at": "2025-10-10T12:00:00Z",
      ...
    }
  ],
  "usage": {
    "completion_tokens": 10,
    "prompt_tokens": 50,
    "total_tokens": 60
  }
}
```

---

## 🔍 Common Patterns

### Upload + Attach Tool Workflow

```bash
# 1. Upload tool
TOOL_ID=$(curl -X POST "https://api.letta.com/v1/tools" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d '{"source_code": "...", "json_schema": {...}}' \
  | python -c "import sys, json; print(json.load(sys.stdin)['id'])")

# 2. Get current agent tools
CURRENT_TOOLS=$(curl "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  | python -c "import sys, json; print(json.dumps([t['id'] for t in json.load(sys.stdin)['tools']]))")

# 3. Attach new tool
curl -X PATCH "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d "{\"tool_ids\": $(echo $CURRENT_TOOLS | jq '. + [\"'$TOOL_ID'\"]')}"
```

### Replace Tool Workflow

```bash
# Detach old, attach new in one operation
OLD_ID="tool-old123"
NEW_ID="tool-new456"

# Get current tools
CURRENT=$(curl "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  | python -c "import sys, json; tools=[t['id'] for t in json.load(sys.stdin)['tools']]; print(json.dumps([NEW_ID if t=='$OLD_ID' else t for t in tools]))")

# Update
curl -X PATCH "https://api.letta.com/v1/agents/agent-abc123" \
  -H "Authorization: Bearer sk-let-..." \
  -H "Content-Type: application/json" \
  -d "{\"tool_ids\": $CURRENT}"
```

---

## ⚠️ Error Handling

### "Unauthorized"

**Error:**
```json
{
  "message": "Unauthorized",
  "details": "You are attempting to access a resource that you don't have permission to access..."
}
```

**Causes:**
1. Missing `Authorization` header
2. Wrong API key
3. **Missing `Content-Type: application/json` header** ← Common!

**Fix:**
```bash
# Always include BOTH headers:
-H "Authorization: Bearer sk-let-YOUR-KEY"
-H "Content-Type: application/json"
```

### "Extra inputs are not permitted"

**Error:**
```json
{
  "detail": "[{'type': 'extra_forbidden', 'loc': ('body', 'name'), 'msg': 'Extra inputs are not permitted', 'input': 'my_tool'}]"
}
```

**Cause:** `name` field at top level instead of inside `json_schema`

**Fix:**
```json
// ❌ Wrong
{
  "name": "my_tool",
  "json_schema": {...}
}

// ✅ Correct
{
  "json_schema": {
    "name": "my_tool",
    ...
  }
}
```

### Rate Limits

Letta API has rate limits (not documented publicly).

**Best Practices:**
- Don't hammer the API
- Use exponential backoff on errors
- Cache GET responses when possible

---

## 💡 Tips & Tricks

### 1. Always Test Tools Before Attaching

Upload → Test standalone → Attach to agent

### 2. Use Tags for Organization

```json
{
  "tags": ["discord", "custom", "v2", "production"]
}
```

### 3. Return Character Limit

Default: 50,000 characters  
Can't be changed via API (yet)

Tool output longer than this will be truncated!

### 4. Tool Descriptions Matter

The AI agent sees the `description` in `json_schema` - make it helpful!

**Bad:**
```json
"description": "Sends a message"
```

**Good:**
```json
"description": "Sends a Discord DM or channel message. Use this when reaching out to specific users or posting in channels. Supports @mentions. IMPORTANT: Call archival_memory_insert after to remember what you sent!"
```

### 5. JSON Schema Validation

Letta validates your JSON schema against JSON Schema Draft 7.

**Common issues:**
- Missing `required` array
- Wrong `type` (e.g., `array` needs `items`)
- Invalid `enum` values

---

## 📚 Further Reading

- **Official Docs:** https://docs.letta.com/
- **GitHub:** https://github.com/letta-ai/letta
- **Discord Community:** https://discord.gg/letta-ai
- **Python SDK:** `pip install letta-ai`

---

**Last Updated:** 2025-10-10  
**Tested With:** Letta API v1  
**Created by:** Mioré 🐾

