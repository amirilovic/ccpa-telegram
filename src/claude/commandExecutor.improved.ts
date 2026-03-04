import { join, resolve } from "node:path";
import type { Context } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";
import { sendChunkedResponse } from "../telegram/chunker.js";
import { sendDownloadFiles } from "../telegram/fileSender.js";
import {
  ensureUserSetup,
  getDownloadsPath,
  getSessionId,
  saveSessionId,
} from "../user/setup.js";
import { getValidClaudeCommand } from "./commands.improved.js";
import { executeClaudeQuery } from "./executor.js";

/**
 * Rate limiting for command execution to prevent abuse
 */
const userCommandCooldown = new Map<number, number>();
const COOLDOWN_DURATION = 2000; // 2 seconds between commands per user

/**
 * Check if user is rate limited
 */
function isRateLimited(userId: number): boolean {
  const lastExecution = userCommandCooldown.get(userId);
  if (!lastExecution) {
    return false;
  }

  const timeSinceLastExecution = Date.now() - lastExecution;
  return timeSinceLastExecution < COOLDOWN_DURATION;
}

/**
 * Update user's rate limit timestamp
 */
function updateRateLimit(userId: number): void {
  userCommandCooldown.set(userId, Date.now());
}

/**
 * Sanitize command arguments to prevent injection attacks
 */
function sanitizeArguments(args: string): string {
  return args
    // Remove or escape potentially dangerous sequences
    .replace(/[<>]/g, '') // Remove HTML-like brackets
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\${[^}]*}/g, '') // Remove variable interpolation patterns
    .trim()
    .slice(0, 1000); // Limit argument length
}

/**
 * Validate command execution context
 */
function validateExecutionContext(ctx: Context): { isValid: boolean; error?: string } {
  // Check for user ID
  if (!ctx.from?.id) {
    return { isValid: false, error: 'Unable to identify user' };
  }

  // Check for chat context
  if (!ctx.chat?.id) {
    return { isValid: false, error: 'Invalid chat context' };
  }

  // Check if user is a bot (prevent bot-to-bot interactions)
  if (ctx.from.is_bot) {
    return { isValid: false, error: 'Bot users cannot execute commands' };
  }

  return { isValid: true };
}

/**
 * Enhanced progress tracking with throttling and error recovery
 */
class ProgressTracker {
  private lastUpdate = 0;
  private lastMessage = '';
  private updateCount = 0;
  private readonly throttleMs = 2000;
  private readonly maxUpdates = 10;

  constructor(
    private ctx: Context,
    private statusMessageId: number,
    private logger: any
  ) {}

  async updateProgress(message: string): Promise<void> {
    const now = Date.now();

    // Throttle updates and prevent spam
    if (
      now - this.lastUpdate < this.throttleMs ||
      message === this.lastMessage ||
      this.updateCount >= this.maxUpdates
    ) {
      return;
    }

    this.lastUpdate = now;
    this.lastMessage = message;
    this.updateCount++;

    try {
      await this.ctx.api.editMessageText(
        this.ctx.chat!.id,
        this.statusMessageId,
        `_${message}_`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      // Log error but don't fail the command execution
      this.logger.debug({ error, message }, 'Failed to update progress message');
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.ctx.api.deleteMessage(this.ctx.chat!.id, this.statusMessageId);
    } catch (error) {
      // Deletion failures are not critical
      this.logger.debug({ error }, 'Failed to delete status message');
    }
  }
}

/**
 * Execute a Claude command with enhanced validation, rate limiting, and error handling
 */
export async function executeClaudeCommand(
  ctx: Context,
  commandName: string,
  args?: string,
): Promise<void> {
  const logger = getLogger();
  const config = getConfig();

  // Validate execution context
  const contextValidation = validateExecutionContext(ctx);
  if (!contextValidation.isValid) {
    await ctx.reply(`❌ ${contextValidation.error}`);
    return;
  }

  const userId = ctx.from!.id;
  logger.debug({
    commandName,
    args: args ? args.slice(0, 100) + (args.length > 100 ? '...' : '') : undefined,
    userId,
    username: ctx.from?.username,
  }, 'Claude command execution requested');

  // Check rate limiting
  if (isRateLimited(userId)) {
    await ctx.reply(
      '⏳ Please wait a moment before executing another command.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Update rate limit
  updateRateLimit(userId);

  try {
    // Get and validate the Claude command
    const command = await getValidClaudeCommand(commandName);
    if (!command) {
      await ctx.reply(
        `❌ Command \`${commandName}\` not found or invalid.`,
        { parse_mode: 'Markdown' }
      );
      logger.warn({ commandName }, 'Attempted to execute non-existent or invalid command');
      return;
    }

    // Validate and sanitize arguments
    let sanitizedArgs: string | undefined;
    if (args?.trim()) {
      sanitizedArgs = sanitizeArguments(args.trim());
      if (sanitizedArgs !== args.trim()) {
        logger.info({ commandName, userId }, 'Command arguments were sanitized');
      }
    }

    const userDir = resolve(join(config.dataDir, String(userId)));

    // Set up user directory with enhanced error handling
    try {
      await ensureUserSetup(userDir);
    } catch (setupError) {
      logger.error({ error: setupError, userId, userDir }, 'User setup failed');
      await ctx.reply(
        '❌ Failed to set up user environment. Please try again later.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Prepare the command prompt
    let prompt = `/${commandName}`;
    if (sanitizedArgs) {
      prompt += ` ${sanitizedArgs}`;
    }

    // Get session and downloads path
    const sessionId = await getSessionId(userDir);
    const downloadsPath = getDownloadsPath(userDir);

    // Send initial status message
    const statusMsg = await ctx.reply('_Executing command..._', {
      parse_mode: 'Markdown',
    });

    const progressTracker = new ProgressTracker(ctx, statusMsg.message_id, logger);

    // Execute the Claude command with enhanced error handling
    logger.debug({ commandName, userId }, 'Starting Claude command execution');

    const startTime = Date.now();
    let result;

    try {
      result = await executeClaudeQuery({
        prompt,
        userDir,
        downloadsPath,
        sessionId,
        onProgress: (message: string) => progressTracker.updateProgress(message),
      });
    } catch (executionError) {
      logger.error({
        error: executionError,
        commandName,
        userId,
        prompt: prompt.slice(0, 200),
      }, 'Claude command execution failed');

      await progressTracker.cleanup();

      await ctx.reply(
        `❌ Failed to execute command \`${commandName}\`.\n\nError: ${
          executionError instanceof Error ? executionError.message : String(executionError)
        }`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const executionTime = Date.now() - startTime;

    // Clean up progress tracking
    await progressTracker.cleanup();

    // Save session ID if received
    if (result.sessionId) {
      try {
        await saveSessionId(userDir, result.sessionId);
        logger.debug({ sessionId: result.sessionId }, 'Session saved');
      } catch (sessionError) {
        logger.warn({ error: sessionError }, 'Failed to save session ID');
      }
    }

    // Send the response with improved formatting
    const responseText = result.success
      ? result.output
      : result.error || 'An error occurred executing the command';

    try {
      await sendChunkedResponse(ctx, responseText);
    } catch (responseError) {
      logger.error({ error: responseError }, 'Failed to send command response');
      await ctx.reply(
        '❌ Command executed but failed to send response. Please try again.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Send any files from downloads folder
    let filesSent = 0;
    try {
      filesSent = await sendDownloadFiles(ctx, userDir);
      if (filesSent > 0) {
        logger.info({ filesSent, commandName, userId }, 'Sent download files to user');
      }
    } catch (fileError) {
      logger.warn({ error: fileError }, 'Failed to send download files');
    }

    // Log successful completion with metrics
    logger.info({
      commandName,
      args: sanitizedArgs,
      userId,
      username: ctx.from?.username,
      success: result.success,
      executionTimeMs: executionTime,
      filesSent,
      outputLength: responseText.length,
    }, 'Claude command executed successfully');

  } catch (error) {
    // Top-level error handler for unexpected errors
    logger.error({
      error,
      commandName,
      args,
      userId,
    }, 'Unexpected error in executeClaudeCommand');

    try {
      await ctx.reply(
        `❌ An unexpected error occurred while executing \`${commandName}\`. Please try again later.`,
        { parse_mode: 'Markdown' }
      );
    } catch (replyError) {
      logger.error({ error: replyError }, 'Failed to send error reply');
    }
  }
}

/**
 * Get command execution statistics for monitoring
 */
export function getCommandExecutionStats(): {
  activeUsers: number;
  rateLimitedUsers: number;
} {
  const now = Date.now();
  let rateLimitedUsers = 0;

  for (const [, lastExecution] of userCommandCooldown) {
    if (now - lastExecution < COOLDOWN_DURATION) {
      rateLimitedUsers++;
    }
  }

  return {
    activeUsers: userCommandCooldown.size,
    rateLimitedUsers,
  };
}

/**
 * Clear rate limiting for a specific user (admin function)
 */
export function clearUserRateLimit(userId: number): void {
  userCommandCooldown.delete(userId);
}

/**
 * Clear all rate limiting (admin function)
 */
export function clearAllRateLimits(): void {
  userCommandCooldown.clear();
}