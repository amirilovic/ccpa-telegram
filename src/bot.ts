import { execSync } from "node:child_process";
import { Bot } from "grammy";
import { clearHandler } from "./bot/commands/clear.js";
import { helpHandler } from "./bot/commands/help.js";
import { startHandler } from "./bot/commands/start.js";
import {
  documentHandler,
  photoHandler,
  textHandler,
  voiceHandler,
} from "./bot/handlers/index.js";
import { authMiddleware } from "./bot/middleware/auth.js";
import { rateLimitMiddleware } from "./bot/middleware/rateLimit.js";
import { getConfig, getWorkingDirectory } from "./config.js";
import { getLogger, initLogger } from "./logger.js";

/**
 * Check if the Claude CLI command is available
 */
function checkClaudeCommand(
  command: string,
  logger: ReturnType<typeof getLogger>,
): void {
  try {
    execSync(`${command} --version`, { stdio: "pipe" });
  } catch {
    logger.fatal(
      { command },
      `Claude CLI command "${command}" not found or not executable. ` +
        `Please ensure Claude Code is installed and the command is in your PATH. ` +
        `You can also set a custom command in ccpa.config.json under "claude.command".`,
    );
    process.exit(1);
  }
}

export async function startBot(): Promise<void> {
  const config = getConfig();
  const workingDir = getWorkingDirectory();

  // Initialize logger with config level
  initLogger(config.logging.level);
  const logger = getLogger();

  logger.info({ workingDir }, "Working directory");
  logger.info({ dataDir: config.dataDir }, "Data directory");

  // Verify Claude CLI is available
  logger.debug({ command: config.claude.command }, "Checking Claude CLI");
  checkClaudeCommand(config.claude.command, logger);
  logger.info({ command: config.claude.command }, "Claude CLI verified");

  // Create bot instance
  const bot = new Bot(config.telegram.botToken);

  // Apply middleware
  bot.use(authMiddleware);
  bot.use(rateLimitMiddleware);

  // Register commands
  bot.command("start", startHandler);
  bot.command("help", helpHandler);
  bot.command("clear", clearHandler);

  // Text message handler
  bot.on("message:text", textHandler);

  // Photo handler
  bot.on("message:photo", photoHandler);

  // Document handler (PDFs, etc.)
  bot.on("message:document", documentHandler);

  // Voice message handler
  bot.on("message:voice", voiceHandler);

  // Error handler
  bot.catch((err) => {
    logger.error({ error: err.error, ctx: err.ctx?.update }, "Bot error");
  });

  // Graceful shutdown
  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "Received shutdown signal");
    await bot.stop();
    logger.info("Bot stopped");
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start bot
  logger.info(
    { allowedUsers: config.access.allowedUserIds.length },
    "Starting Telegram Claude Bot",
  );

  await bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, "Bot is running");
    },
  });
}
