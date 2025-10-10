# 🔧 Letta Tools

Custom tools for Letta AI agents, with management scripts.

## 📁 What's in this folder

### 🤖 Tools
- `send_discord_message.py` + `.json` - Unified Discord messaging (DMs + channels + mentions)

### 🛠️ Management Scripts
- `upload-tool.py` - Upload tools to Letta API
- `manage-agent-tools.py` - Attach/detach/list tools on agents  
- `pull-current-tools.py` - Backup current agent tools

### 📚 Documentation
- `TOOL_MANAGEMENT_GUIDE.md` - Complete guide for tool management
- `USAGE_EXAMPLES.md` - Examples for using `send_discord_message`

---

## 🚀 Quick Start

```bash
# 1. Set up credentials
export LETTA_API_KEY="sk-let-your-key"
export LETTA_AGENT_ID="agent-your-id"

# 2. Upload a tool and attach to agent
python upload-tool.py send_discord_message

# 3. List agent's tools
python manage-agent-tools.py list
```

**👉 Read the full guide:** [TOOL_MANAGEMENT_GUIDE.md](./TOOL_MANAGEMENT_GUIDE.md)

---

## 📝 Creating Your Own Tool

1. Create `your_tool.py` with your function
2. Create `your_tool.json` with the schema
3. Run `python upload-tool.py your_tool`

See [TOOL_MANAGEMENT_GUIDE.md](./TOOL_MANAGEMENT_GUIDE.md) for detailed examples!

---

**Made with ❤️ by Mioré**
