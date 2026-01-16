# ccpa-telegram

A Telegram bot that provides access to Claude Code as a personal assistant. Run Claude Code in any directory and interact with it through Telegram.

## Features

- Chat with Claude Code via Telegram
- Send images and documents for analysis
- **Voice message support** with local Whisper transcription
- Persistent conversation sessions per user
- Configurable Claude settings per project
- Multi-user support with access control

## How It Works

This bot runs Claude Code as a subprocess in your chosen working directory. Claude Code reads all its standard configuration files from that directory, exactly as it would when running directly in a terminal:

- `CLAUDE.md` - Project-specific instructions and context
- `.claude/settings.json` - Permissions and tool settings
- `.claude/commands/` - Custom slash commands
- `.mcp.json` - MCP server configurations

This means you get the full power of Claude Code - including file access, code execution, and any configured MCP tools - all accessible through Telegram.

For complete documentation on Claude Code configuration, see the [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code).

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://github.com/anthropics/claude-code) installed and authenticated.
- A Telegram bot token (from [@BotFather](https://t.me/BotFather)). See [Creating a Telegram Bot](#creating-a-telegram-bot) for instructions.
- **ffmpeg** (required for voice messages) - install with `brew install ffmpeg` on macOS

## Quick Start

```bash
# Initialize a new project
npx ccpa-telegram init

# Edit ccpa.config.json with your bot token and allowed user IDs

# Start the bot
npx ccpa-telegram
```

## Installation

### Using npx (recommended)

```bash
npx ccpa-telegram init --cwd ./my-project
npx ccpa-telegram --cwd ./my-project
```

## Configuration

### ccpa.config.json

Create a `ccpa.config.json` file in your project directory:

```json
{
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN_HERE"
  },
  "access": {
    "allowedUserIds": [123456789]
  },
  "claude": {
    "command": "claude"
  },
  "logging": {
    "level": "info"
  },
  "transcription": {
    "model": "turbo",
    "showTranscription": true
  }
}
```

### Configuration Options

| Option                          | Description                                                    | Default    |
| ------------------------------- | -------------------------------------------------------------- | ---------- |
| `telegram.botToken`             | Telegram bot token from BotFather                              | Required   |
| `access.allowedUserIds`         | Array of Telegram user IDs allowed to use the bot              | `[]`       |
| `claude.command`                | Claude CLI command                                             | `"claude"` |
| `logging.level`                 | Log level: debug, info, warn, error                            | `"info"`   |
| `transcription.model`           | Whisper model: tiny, base, small, medium, large, turbo         | `"turbo"`  |
| `transcription.showTranscription` | Show transcribed text before Claude response                 | `true`     |

### Environment Variables

Environment variables override config file values:

| Variable             | Description                          |
| -------------------- | ------------------------------------ |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token                   |
| `ALLOWED_USER_IDS`   | Comma-separated user IDs             |
| `CLAUDE_COMMAND`     | Claude CLI command                   |
| `LOG_LEVEL`          | Logging level                        |
| `WHISPER_MODEL`      | Whisper model for voice transcription |
| `SHOW_TRANSCRIPTION` | Show transcription (true/false)      |

## Directory Structure

```
my-project/
├── ccpa.config.json      # Bot configuration
├── CLAUDE.md             # Claude system prompt
├── .claude/
│   └── settings.json     # Claude settings
└── .ccpa/
    └── users/
        └── {userId}/
            ├── uploads/      # Uploaded files
            └── session.json  # Session data
```

## CLI Commands

```bash
# Show help
npx ccpa-telegram --help

# Initialize config file
npx ccpa-telegram init
npx ccpa-telegram init --cwd ./my-project

# Start the bot
npx ccpa-telegram
npx ccpa-telegram --cwd ./my-project
```

## Bot Commands

| Command  | Description                |
| -------- | -------------------------- |
| `/start` | Welcome message            |
| `/help`  | Show help information      |
| `/clear` | Clear conversation history |

## Creating a Telegram Bot

To create a new Telegram bot and get your bot token:

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Choose a **display name** for your bot (e.g., "My Claude Assistant")
4. Choose a **username** - must be unique and end with `bot` (e.g., `my_claude_assistant_bot`). The length of the username must be between 5 and 32 characters.
5. BotFather will reply with your bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
6. Copy this token to your `ccpa.config.json`

For detailed instructions, see the [Telegram Bot API documentation](https://core.telegram.org/bots#how-do-i-create-a-bot).

## Finding Your Telegram User ID

To find your Telegram user ID:

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID
3. Add this ID to `allowedUserIds` in your config

## Voice Messages

Voice messages are transcribed locally using [Whisper](https://github.com/openai/whisper) via the `nodejs-whisper` package. No audio data is sent to external services.

### Whisper Models

| Model   | Size    | Speed vs Real-time | Quality                        |
| ------- | ------- | ------------------ | ------------------------------ |
| `tiny`  | ~1 GB   | ~10x faster        | Basic, English-focused         |
| `base`  | ~1 GB   | ~7x faster         | Good for clear speech          |
| `small` | ~2 GB   | ~4x faster         | Good multilingual              |
| `medium`| ~5 GB   | ~2x faster         | Very good multilingual         |
| `large` | ~10 GB  | ~1x (real-time)    | Best quality                   |
| `turbo` | ~6 GB   | ~8x faster         | Near-large quality (default)   |

**First run**: The model will be downloaded automatically (~6GB for turbo). Subsequent runs use the cached model.

### Supported Languages

Whisper supports 50+ languages including English, German, Serbian, Spanish, French, and many more. The `turbo` model provides excellent quality for most languages.

## Security Notice

**Important**: Conversations with this bot are not end-to-end encrypted. Messages pass through Telegram's servers and are processed by the Claude API. Do not share sensitive information such as:

- Passwords or API keys
- Personal identification numbers
- Financial information
- Confidential business data
- Any other private or sensitive data

This bot is intended for development assistance and general queries only. Treat all conversations as potentially visible to third parties.

## License

ISC
