#!/usr/bin/env node

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startBot } from "./bot.js";
import { initConfig } from "./config.js";
import { getLogger } from "./logger.js";

interface ParsedArgs {
  command: "start" | "init";
  cwd: string;
}

const CONFIG_TEMPLATE = `{
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN_HERE"
  },
  "access": {
    "allowedUserIds": []
  },
  "claude": {
    "command": "claude"
  },
  "logging": {
    "level": "info"
  }
}
`;

function showHelp(): void {
  console.log(`
ccpa-telegram - Claude Code Personal Assistant for Telegram

Usage:
  npx ccpa-telegram [command] [options]

Commands:
  init            Create ccpa.config.json in the working directory
  start           Start the bot (default)

Options:
  --cwd <path>    Working directory (default: current directory)
  --help, -h      Show this help message

Examples:
  npx ccpa-telegram init
  npx ccpa-telegram init --cwd ./my-project
  npx ccpa-telegram
  npx ccpa-telegram --cwd ./my-project

Configuration (ccpa.config.json):
  {
    "telegram": {
      "botToken": "your-bot-token"
    },
    "access": {
      "allowedUserIds": [123456789]
    },
    "claude": {
      "command": "claude"
    }
  }

Environment variables (override config file):
  TELEGRAM_BOT_TOKEN    - Telegram bot token (required)
  ALLOWED_USER_IDS      - Comma-separated user IDs
  CLAUDE_COMMAND        - Claude CLI command (default: claude)
  LOG_LEVEL             - Logging level (default: info)
`);
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let command: "start" | "init" = "start";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--cwd" && args[i + 1]) {
      cwd = resolve(process.cwd(), args[i + 1]);
      i++;
    } else if (arg.startsWith("--cwd=")) {
      cwd = resolve(process.cwd(), arg.slice(6));
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    } else if (arg === "init") {
      command = "init";
    } else if (arg === "start") {
      command = "start";
    }
  }

  return { command, cwd };
}

async function runInit(cwd: string): Promise<void> {
  const configPath = join(cwd, "ccpa.config.json");

  if (existsSync(configPath)) {
    console.error(`Error: ccpa.config.json already exists in ${cwd}`);
    process.exit(1);
  }

  await writeFile(configPath, CONFIG_TEMPLATE, "utf-8");
  console.log(`Created ccpa.config.json in ${cwd}`);
  console.log(`\nNext steps:`);
  console.log(`1. Edit ccpa.config.json and add your Telegram bot token`);
  console.log(`2. Add allowed user IDs to the "allowedUserIds" array`);
  console.log(`3. Run: npx ccpa-telegram --cwd ${cwd}`);
  process.exit(0);
}

async function runStart(cwd: string): Promise<void> {
  // Initialize config with working directory
  initConfig(cwd);

  getLogger().info({ cwd }, "Starting ccpa-telegram");

  // Start the bot
  await startBot();
}

async function main(): Promise<void> {
  const { command, cwd } = parseArgs();

  if (command === "init") {
    await runInit(cwd);
  } else {
    await runStart(cwd);
  }
}

main().catch((error) => {
  console.error("Failed to start:", error.message || error);
  process.exit(1);
});
