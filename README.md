# ccpa-telegram

A Telegram bot that provides access to Claude Code as a personal assistant. Run Claude Code in any directory and interact with it through Telegram.

## Features

- Chat with Claude Code via Telegram
- Send images and documents for analysis
- **Voice message support** with local Whisper transcription
- **File sending** - Claude can send files back to you
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
    "model": "base.en",
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
| `transcription.model`           | Whisper model (see [Voice Messages](#voice-messages))          | `"base.en"`|
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
            ├── uploads/      # Files FROM user (to Claude)
            ├── downloads/    # Files TO user (from Claude)
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

### Prerequisites for Voice Messages

Voice transcription requires additional setup:

1. **ffmpeg** - For audio conversion
   ```bash
   # macOS
   brew install ffmpeg

   # Ubuntu/Debian
   sudo apt install ffmpeg
   ```

2. **CMake** - For building the Whisper executable
   ```bash
   # macOS
   brew install cmake

   # Ubuntu/Debian
   sudo apt install cmake
   ```

3. **Download and build Whisper** - Run this once after installation:
   ```bash
   npx nodejs-whisper download
   ```
   This downloads the Whisper model and compiles the `whisper-cli` executable. The build process takes a few minutes.

### Whisper Models

| Model            | Size    | Speed    | Quality                        |
| ---------------- | ------- | -------- | ------------------------------ |
| `tiny`           | ~75 MB  | Fastest  | Basic quality                  |
| `tiny.en`        | ~75 MB  | Fastest  | English-only, slightly better  |
| `base`           | ~142 MB | Fast     | Good for clear speech          |
| `base.en`        | ~142 MB | Fast     | English-only (default)         |
| `small`          | ~466 MB | Medium   | Good multilingual              |
| `small.en`       | ~466 MB | Medium   | English-only                   |
| `medium`         | ~1.5 GB | Slower   | Very good multilingual         |
| `medium.en`      | ~1.5 GB | Slower   | English-only                   |
| `large-v1`       | ~2.9 GB | Slowest  | Best quality (v1)              |
| `large`          | ~2.9 GB | Slowest  | Best quality (v2)              |
| `large-v3-turbo` | ~1.5 GB | Fast     | Near-large quality, faster     |

**First run**: The selected model will be downloaded automatically. Subsequent runs use the cached model.

### Supported Languages

Whisper supports 50+ languages including English, German, Spanish, French, and many more. Use models without `.en` suffix for multilingual support.

## Sending Files to User

Claude can send files back to you through Telegram. Each user has a dedicated `downloads/` folder, and Claude is informed of this path in every prompt.

### How It Works

1. **Claude writes a file** to your downloads folder (e.g., `.ccpa/users/{userId}/downloads/report.pdf`)
2. **The bot detects** the new file after Claude's response completes
3. **The file is sent** to you via Telegram (as a document)
4. **The file is deleted** from the server after successful delivery

### Example Usage

Ask Claude to create and send you a file:

```
Create a simple hello.txt file in my downloads folder with "Hello World" content
```

Claude will write the file to your downloads path, and the bot will automatically send it to you.

### Supported Files

Any file type that Telegram supports can be sent, including:
- Documents (PDF, TXT, CSV, JSON, etc.)
- Images (PNG, JPG, etc.)
- Archives (ZIP, TAR, etc.)

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
