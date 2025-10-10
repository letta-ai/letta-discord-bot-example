# 📚 API Documentation

Quick-reference guides for the APIs we use in this project.

---

## 🤖 [Letta AI API](./LETTA_API_REFERENCE.md)

Everything you need to work with Letta's REST API:
- ✅ Tool management (create, update, delete)
- ✅ Agent configuration (attach/detach tools)
- ✅ Common pitfalls & fixes
- ✅ Real-world examples from our testing

**Read:** [LETTA_API_REFERENCE.md](./LETTA_API_REFERENCE.md)

**Key Learnings:**
- `Content-Type: application/json` header is CRITICAL
- Tool `name` goes inside `json_schema`, not top-level
- PATCH /agents requires FULL tool list, not just changes

---

## 💬 [Discord API](./DISCORD_API_REFERENCE.md)

Bot essentials for Discord integration:
- ✅ Sending DMs & channel messages
- ✅ Reading message history
- ✅ Handling attachments
- ✅ Rate limits & error handling
- ✅ Message chunking (2000 char limit)

**Read:** [DISCORD_API_REFERENCE.md](./DISCORD_API_REFERENCE.md)

**Key Learnings:**
- DMs require 2 steps: create channel → send message
- Messages max 2000 chars → chunk longer ones
- Bot token format: `Bot YOUR_TOKEN` (not `Bearer`)

---

## 🛠️ Why These Docs Exist

During development, we discovered:
- Official docs were scattered or unclear
- Some gotchas weren't documented
- We wasted time on trial-and-error

**This is our "learned the hard way" knowledge base!**

Use these as:
- Quick reference during development
- Error debugging guide
- Foundation for your own projects

---

## 📖 Official Documentation Links

**Letta:**
- Docs: https://docs.letta.com/
- GitHub: https://github.com/letta-ai/letta
- Discord: https://discord.gg/letta-ai

**Discord:**
- Developer Portal: https://discord.com/developers/docs
- API Reference: https://discord.com/developers/docs/reference
- Developer Server: https://discord.gg/discord-developers

---

## 🔄 Updates

These docs are living documents! As we discover new patterns or hit new issues, we update them.

**Last Updated:** 2025-10-10  
**Maintained by:** Mioré 🐾

---

**See also:**
- [Tool Management Guide](../../tools/TOOL_MANAGEMENT_GUIDE.md) - Scripts for Letta tool management
- [PM2 Setup Guide](../../pi-bot-repo/docs/PM2_SETUP_GUIDE.md) - Running the bot on Raspberry Pi

