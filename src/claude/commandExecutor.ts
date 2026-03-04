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
import { getClaudeCommand } from "./commands.js";
import { executeClaudeQuery } from "./executor.js";

/**
 * Execute a Claude command triggered by Telegram
 */
export async function executeClaudeCommand(
  ctx: Context,
  commandName: string,
  args?: string,
): Promise<void> {
  const logger = getLogger();
  const config = getConfig();
  logger.debug({ commandName, args }, "Executing Claude command");

  // Get the Claude command definition
  const command = await getClaudeCommand(commandName);
  if (!command) {
    await ctx.reply(`❌ Command \`${commandName}\` not found.`, {
      parse_mode: "Markdown",
    });
    return;
  }

  const userId = ctx.from?.id;
  const messageTimestamp = ctx.message?.date;
  if (!userId) {
    await ctx.reply("❌ Unable to identify user.");
    return;
  }

  const userDir = resolve(join(config.dataDir, String(userId)));

  try {
    // Set up user directory
    await ensureUserSetup(userDir);

    // Prepare the command prompt
    let prompt = `/${commandName}`;
    if (args?.trim()) {
      prompt += ` ${args.trim()}`;
    }

    // Get session and downloads path
    const sessionId = await getSessionId(userDir);
    const downloadsPath = getDownloadsPath(userDir);

    // Send initial status message
    const statusMsg = await ctx.reply("_Executing command..._", {
      parse_mode: "Markdown",
    });

    // Progress callback
    let lastProgressUpdate = Date.now();
    let lastProgressText = "Executing command...";

    const onProgress = async (message: string) => {
      const now = Date.now();
      if (now - lastProgressUpdate > 2000 && message !== lastProgressText) {
        lastProgressUpdate = now;
        lastProgressText = message;
        try {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            `_${message}_`,
            { parse_mode: "Markdown" },
          );
        } catch {
          // Ignore edit errors
        }
      }
    };

    // Execute the Claude command
    logger.debug("Executing Claude command query");
    const result = await executeClaudeQuery({
      prompt,
      userDir,
      downloadsPath,
      sessionId,
      onProgress,
      messageTimestamp,
    });

    // Delete status message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    } catch {
      // Ignore delete errors
    }

    // Save session ID if received
    if (result.sessionId) {
      await saveSessionId(userDir, result.sessionId);
      logger.debug({ sessionId: result.sessionId }, "Session saved");
    }

    // Send the response
    const responseText = result.success
      ? result.output
      : result.error || "An error occurred executing the command";

    await sendChunkedResponse(ctx, responseText);

    // Send any files from downloads folder
    const filesSent = await sendDownloadFiles(ctx, userDir);
    if (filesSent > 0) {
      logger.info({ filesSent, commandName }, "Sent download files to user");
    }

    logger.info(
      { commandName, args, userId, success: result.success },
      "Claude command executed",
    );
  } catch (error) {
    logger.error(
      { error, commandName, args },
      "Failed to execute Claude command",
    );
    await ctx.reply(
      `❌ Failed to execute command \`${commandName}\`.\n\nError: ${error instanceof Error ? error.message : String(error)}`,
      { parse_mode: "Markdown" },
    );
  }
}
