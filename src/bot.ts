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

export async function startBot(): Promise<void> {
  const config = getConfig();
  const workingDir = getWorkingDirectory();

  // Initialize logger with config level
  initLogger(config.logging.level);
  const logger = getLogger();

  logger.info({ workingDir }, "Working directory");
  logger.info({ dataDir: config.dataDir }, "Data directory");

  // Check for Anthropic API key
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.fatal(
      "ANTHROPIC_API_KEY environment variable is required. " +
        "Get your API key at https://console.anthropic.com",
    );
    process.exit(1);
  }

  logger.info("Claude Agent SDK ready");

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
