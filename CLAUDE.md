# CCPA Telegram Bot

Telegram bot that runs Claude Code as a personal assistant.

## Tech Stack

- TypeScript, Node.js 18+
- Grammy (Telegram bot framework)
- Pino (logging)
- Zod (config validation)
- Biome (linting/formatting)
- pnpm (package manager)

## Commands

```bash
pnpm run dev       # Development with hot reload
pnpm run build     # Compile TypeScript
pnpm run lint      # Check linting and formatting
pnpm run lint:fix  # Fix linting and formatting
```

## Project Structure

- `src/cli.ts` - CLI entry point
- `src/bot.ts` - Bot initialization
- `src/config.ts` - Configuration loading (ccpa.config.json + env vars)
- `src/bot/handlers/` - Message handlers (text, photo, document)
- `src/bot/commands/` - Bot commands (/start, /help, /clear)
- `src/claude/` - Claude Code CLI integration
- `src/user/` - User session management

## Key Patterns

- Config loaded from `ccpa.config.json` with env var overrides
- User data stored in `.ccpa/users/{userId}/`
- Claude runs as subprocess reading config from working directory
- Streaming JSON output parsed for progress updates
