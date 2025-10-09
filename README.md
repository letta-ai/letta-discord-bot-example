# 🤖 Discord Bot with Letta AI

A powerful, production-ready Discord bot integrated with [Letta AI](https://www.letta.com/) for intelligent conversations with long-term memory, task scheduling, and image processing capabilities.

## ✨ Features

### 🧠 **Letta AI Integration**
- Intelligent conversations with persistent memory
- Context-aware responses across sessions
- Customizable agent personalities
- Streaming responses for real-time interaction
- Automatic message chunking for long responses (Discord 2000 char limit)

### 📸 **Image Processing**
- Multi-image support (up to 10 images per message)
- Automatic compression for large files (4MB+ → optimized)
- Security: SSRF protection (Discord CDN only)
- Rate limiting: 1 request per 3 seconds per user
- Supports JPEG, PNG, WebP formats

### ⏰ **Task Scheduler**
- Schedule notifications and reminders
- Recurring tasks (daily, hourly, custom intervals)
- One-time or repeating tasks
- User mentions and channel posts
- JSON-based task configuration

### 🔔 **Heartbeat System** (Optional)
- Autonomous agent activity
- Configurable intervals and probability
- Allows agent to reflect and self-organize

### 🔒 **Security & Performance**
- Input validation on all URLs
- Memory leak prevention
- Proper error handling with user-friendly messages
- PM2 support for 24/7 operation
- Rate limiting per user

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **Discord Bot** - [Create one here](https://discord.com/developers/applications)
- **Letta API Account** - [Sign up at letta.com](https://www.letta.com/)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/Duzafizzl/Letta-Discord-advanced.git
cd Letta-Discord-advanced
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
# Copy the example env file
cp .env.example .env

# Edit .env with your values
nano .env  # or use your preferred editor
```

4. **Build TypeScript**
```bash
npm run build
```

5. **Start the bot**
```bash
npm start
```

## ⚙️ Configuration

### Required Environment Variables

```env
# Discord
DISCORD_TOKEN=your_discord_bot_token

# Letta AI
LETTA_API_KEY=your_letta_api_key
LETTA_AGENT_ID=your_agent_id
```

### Optional Configuration

See `.env.example` for all available options including:
- Response modes (mentions, DMs, channels)
- Task scheduler settings
- Heartbeat/timer configuration
- Logging preferences

## 📦 Deployment

### Local Development

```bash
npm run dev
```

### Production with PM2 (24/7)

```bash
# Install PM2 globally
npm install -g pm2

# Start bot
npm run pm2:start

# View logs
npm run pm2:logs

# Restart bot
npm run pm2:restart

# Auto-start on system boot
pm2 startup
pm2 save
```

### Cloud Deployment

You can deploy to various cloud platforms:
- **Railway** - One-click deploy
- **Heroku** - Free tier available
- **DigitalOcean** - Droplets starting at $5/month
- **AWS/GCP/Azure** - Enterprise options
- **Any VPS** - Self-hosted with PM2

## 🗓️ Task Scheduler

Create scheduled tasks in your designated tasks channel:

```json
{
  "task_name": "morning_reminder",
  "description": "Daily good morning message",
  "schedule": "daily",
  "next_run": "2025-10-10T09:00:00",
  "action_type": "user_reminder",
  "action_target": "USER_ID_HERE",
  "action_template": "Good morning! Have a great day! ☀️",
  "one_time": false,
  "active": true
}
```

### Schedule Formats

- `daily` - Every day at the specified time
- `hourly` - Every hour
- `minutely` - Every minute (for testing)
- `every_X_minutes` - Custom minute interval
- `every_X_hours` - Custom hour interval
- `every_X_days` - Custom day interval
- `weekly` - Every 7 days
- `monthly` - Every month

The bot checks for due tasks every 60 seconds.

## 📸 Image Processing

Send images to the bot and it will analyze them using Letta AI's vision capabilities.

### Features:
- ✅ Up to 10 images per message
- ✅ Automatic compression for large files
- ✅ Security validation (Discord CDN only)
- ✅ Detailed error messages
- ✅ Rate limiting to prevent spam

### Example:

Simply upload an image and add text:
```
@BotName What's in this image?
```

The bot will:
1. Download the image(s)
2. Compress if needed (>4MB → WebP/JPEG optimized)
3. Send to Letta AI for analysis
4. Reply with the AI's description

## 🛠️ Letta Tools

This bot comes with pre-configured Letta tools for Discord interaction. You need to set these up in your Letta agent:

### Required Tools:

1. **send_discord_dm** - Send direct messages to users
2. **send_discord_message** - Post in Discord channels
3. **create_scheduled_task** - Create new scheduled tasks
4. **delete_scheduled_task** - Remove scheduled tasks

See [docs/LETTA_TOOLS.md](docs/LETTA_TOOLS.md) for detailed tool schemas and setup instructions.

## 📚 Documentation

- [Letta Tools Setup](docs/LETTA_TOOLS.md) - Discord tool configurations
- [Image Processing](docs/ATTACHMENT_FORWARDER_TESTS.md) - Image handling details
- [Contributing](CONTRIBUTING.md) - How to contribute

## 🐛 Troubleshooting

### Bot won't start

```bash
# Check logs
npm run pm2:logs

# Common issues:
# - Missing .env file → cp .env.example .env
# - Invalid Discord token → check Discord Developer Portal
# - Missing dependencies → npm install
```

### Task scheduler not working

- Ensure `TASKS_CHANNEL_ID` is set in `.env`
- Check channel permissions (bot needs read access)
- View logs: `npm run pm2:logs`

### Images not processing

- Check if `sharp` is installed: `npm list sharp`
- Install system dependencies (Debian/Ubuntu): `sudo apt install libvips-dev`
- Rebuild Sharp: `npm install sharp --build-from-source`

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Letta AI](https://www.letta.com/) - For the amazing AI platform
- [Discord.js](https://discord.js.org/) - For the Discord API wrapper
- [Sharp](https://sharp.pixelplumbing.com/) - For image processing

## 🔗 Links

- [Letta Documentation](https://docs.letta.com/)
- [Discord.js Guide](https://discordjs.guide/)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/)

---

**Made with ❤️ for the community**

*If you find this project helpful, consider giving it a ⭐ on GitHub!*

