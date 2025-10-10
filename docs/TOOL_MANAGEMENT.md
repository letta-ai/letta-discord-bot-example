# 🔧 Tool Management Guide

**How to view, backup, and manage your Letta agent's tools**

---

## 📋 Overview

This guide shows you how to:
- ✅ List all tools currently on your agent
- ✅ Backup tool definitions
- ✅ Document tools in your repository
- ✅ Sync tools between environments

**Note:** Tool upload/update via API is currently not reliable. Manual upload via https://app.letta.com/ is recommended.

---

## 📥 Viewing Your Current Tools

### Method 1: Via curl (No dependencies!)

```bash
# Set your credentials
export LETTA_API_KEY="your_api_key_here"
export LETTA_AGENT_ID="agent-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# List all tools on your agent
curl -s -X GET \
  "https://api.letta.com/v1/agents/${LETTA_AGENT_ID}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -m json.tool
```

**Output:** Full agent details including tools list

### Method 2: Get Just Tool Names

```bash
curl -s -X GET \
  "https://api.letta.com/v1/agents/${LETTA_AGENT_ID}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -c "import sys, json; data=json.load(sys.stdin); print('\n'.join(data.get('tools', [])))"
```

**Output:**
```
send_message
archival_memory_insert
archival_memory_search
conversation_search
send_discord_dm
send_discord_channel_message
create_scheduled_task
delete_scheduled_task
```

### Method 3: Get Tool Details

```bash
# Get details for specific tool
TOOL_NAME="send_discord_dm"

curl -s -X GET \
  "https://api.letta.com/v1/tools/${TOOL_NAME}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -m json.tool
```

**Output:** Full tool definition with source code and JSON schema

---

## 💾 Backing Up Tools

### Quick Backup Script

Create `backup-tools.sh`:

```bash
#!/bin/bash
# Backup all tools from Letta agent

LETTA_API_KEY="your_api_key_here"
LETTA_AGENT_ID="agent-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
BACKUP_DIR="./tools-backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

# Get list of tools
TOOLS=$(curl -s -X GET \
  "https://api.letta.com/v1/agents/${LETTA_AGENT_ID}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -c "import sys, json; data=json.load(sys.stdin); print(' '.join(data.get('tools', [])))")

echo "📥 Backing up tools: $TOOLS"

# Backup each tool
for TOOL in $TOOLS; do
  echo "  Downloading $TOOL..."
  curl -s -X GET \
    "https://api.letta.com/v1/tools/${TOOL}" \
    -H "Authorization: Bearer ${LETTA_API_KEY}" \
    > "$BACKUP_DIR/${TOOL}.json"
done

echo "✅ Backup complete: $BACKUP_DIR"
```

**Usage:**
```bash
chmod +x backup-tools.sh
./backup-tools.sh
```

---

## 📝 Documenting Tools in Your Repo

### Recommended Structure

```
your-repo/
├── docs/
│   ├── LETTA_TOOLS.md         # Setup guide with schemas + code
│   ├── TOOLS_UNIFIED.md       # Optional unified tool
│   └── TOOL_MANAGEMENT.md     # This file
└── tools/                     # Actual tool files (optional)
    ├── send_discord_dm.py
    ├── send_discord_dm.json
    ├── send_discord_channel_message.py
    └── send_discord_channel_message.json
```

### Extract Tools to Files

```bash
# Download tool to file
TOOL_NAME="send_discord_dm"
LETTA_API_KEY="your_key"

# Get full tool JSON
curl -s -X GET \
  "https://api.letta.com/v1/tools/${TOOL_NAME}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  > "${TOOL_NAME}.json"

# Extract just the Python source code
curl -s -X GET \
  "https://api.letta.com/v1/tools/${TOOL_NAME}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('source_code', ''))" \
  > "${TOOL_NAME}.py"
```

---

## ⚠️ Known Limitations

### API Upload Issues

**Problem:** Letta API sometimes returns "Unauthorized" errors even with valid API keys when trying to upload/update tools.

**Workaround:** Use the web interface at https://app.letta.com/

**Status:** Issue tracked - see [GitHub Issue #XX](#)

### Why Manual Upload is Better

1. ✅ **Visual feedback** - See tool instantly in UI
2. ✅ **Auto-schema generation** - Letta generates JSON schema from Python
3. ✅ **Validation** - Immediate syntax checking
4. ✅ **No auth issues** - Always works!
5. ✅ **Easy testing** - Test tool immediately after creation

---

## 🔄 Tool Sync Workflow

### For Solo Developers

```bash
# 1. Document your tools
cd your-repo/docs
# Edit LETTA_TOOLS.md with your tool definitions

# 2. Commit to Git
git add docs/LETTA_TOOLS.md
git commit -m "docs: Update Letta tools"
git push

# 3. Upload via web interface
# Open https://app.letta.com/
# Copy-paste from LETTA_TOOLS.md
```

### For Teams

```bash
# 1. Pull latest tools from Letta
./backup-tools.sh

# 2. Commit backup to repo
git add tools-backup-*/
git commit -m "backup: Letta tools $(date +%Y-%m-%d)"
git push

# 3. Team members pull and review
git pull
cat tools-backup-*/send_discord_dm.json

# 4. Team members manually upload to their agents
# Each person goes to https://app.letta.com/
# Copy-paste tool definitions
```

---

## 🎯 Best Practices

### DO:
- ✅ Keep tool definitions in your repo (Git)
- ✅ Use descriptive tool names
- ✅ Document what each tool does
- ✅ Test tools after changes
- ✅ Backup before major changes

### DON'T:
- ❌ Commit API keys to Git!
- ❌ Commit Discord bot tokens!
- ❌ Trust API upload without testing
- ❌ Skip documentation
- ❌ Make changes without backup

### Security Checklist:
```bash
# Check .gitignore includes sensitive files
cat .gitignore | grep -E "\.env|\.key|token|secret"

# Should show:
# .env
# .env.local
# *.key
# *token*
# *secret*
```

---

## 📊 Tool Audit Script

Check what tools you have vs what you should have:

```bash
#!/bin/bash
# audit-tools.sh - Compare expected vs actual tools

LETTA_API_KEY="your_key"
LETTA_AGENT_ID="your_agent_id"

# Expected tools (edit this list!)
EXPECTED_TOOLS=(
  "send_message"
  "archival_memory_insert"
  "archival_memory_search"
  "send_discord_dm"
  "send_discord_channel_message"
  "create_scheduled_task"
  "delete_scheduled_task"
)

# Get actual tools
ACTUAL_TOOLS=$(curl -s -X GET \
  "https://api.letta.com/v1/agents/${LETTA_AGENT_ID}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -c "import sys, json; data=json.load(sys.stdin); print(' '.join(data.get('tools', [])))")

echo "📊 Tool Audit"
echo "============="
echo ""
echo "Expected tools:"
for tool in "${EXPECTED_TOOLS[@]}"; do
  if [[ " $ACTUAL_TOOLS " =~ " $tool " ]]; then
    echo "  ✅ $tool"
  else
    echo "  ❌ $tool (MISSING!)"
  fi
done

echo ""
echo "Actual tools:"
echo "$ACTUAL_TOOLS" | tr ' ' '\n' | while read tool; do
  if [[ " ${EXPECTED_TOOLS[@]} " =~ " $tool " ]]; then
    echo "  ✅ $tool"
  else
    echo "  ⚠️  $tool (not in expected list)"
  fi
done
```

---

## 🆘 Troubleshooting

### "Unauthorized" Error

```bash
# Verify your API key is correct
echo $LETTA_API_KEY | wc -c  # Should be >50 characters

# Test API key
curl -s -X GET \
  "https://api.letta.com/v1/agents" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -m json.tool
```

### Empty Tools List

```bash
# Check if agent ID is correct
curl -s -X GET \
  "https://api.letta.com/v1/agents/${LETTA_AGENT_ID}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -c "import sys, json; data=json.load(sys.stdin); print('Agent name:', data.get('name'))"
```

### JSON Parsing Errors

```bash
# Install jq for better JSON handling (optional)
brew install jq  # macOS
sudo apt install jq  # Linux

# Then use jq instead of python3 -m json.tool
curl -s ... | jq '.'
curl -s ... | jq '.tools[]'  # Just tool names
```

---

## 📚 Additional Resources

- **Letta API Docs:** https://docs.letta.com/api
- **Discord API Docs:** https://discord.com/developers/docs
- **curl Manual:** https://curl.se/docs/manual.html

---

## 🎯 Quick Reference

```bash
# LIST TOOLS
curl -s "https://api.letta.com/v1/agents/${LETTA_AGENT_ID}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -c "import sys, json; print('\n'.join(json.load(sys.stdin).get('tools', [])))"

# GET TOOL DETAILS
curl -s "https://api.letta.com/v1/tools/TOOL_NAME" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -m json.tool

# BACKUP ALL TOOLS
for tool in $(curl -s "https://api.letta.com/v1/agents/${LETTA_AGENT_ID}" \
  -H "Authorization: Bearer ${LETTA_API_KEY}" \
  | python3 -c "import sys, json; print(' '.join(json.load(sys.stdin).get('tools', [])))"); do
  curl -s "https://api.letta.com/v1/tools/$tool" \
    -H "Authorization: Bearer ${LETTA_API_KEY}" > "${tool}.json"
done
```

---

**Remember:** Manual upload via https://app.letta.com/ is the most reliable method! 🎯

**Made with ❤️ by the community**

