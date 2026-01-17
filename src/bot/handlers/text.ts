import { join, resolve } from "node:path";
import type { Context } from "grammy";
import { executeClaudeQuery } from "../../claude/executor.js";
import { getConfig } from "../../config.js";
import { getLogger } from "../../logger.js";
import { sendChunkedResponse } from "../../telegram/chunker.js";
import { sendDownloadFiles } from "../../telegram/fileSender.js";
import {
  ensureUserSetup,
  getDownloadsPath,
  getSessionId,
  saveSessionId,
} from "../../user/setup.js";

/**
 * Handle text messages - routes to Claude
 */
export async function textHandler(ctx: Context): Promise<void> {
  const config = getConfig();
  const logger = getLogger();
  const userId = ctx.from?.id;
  const messageText = ctx.message?.text;

  if (!userId || !messageText) {
    return;
  }

  logger.debug(
    {
      userId,
      username: ctx.from?.username,
      name: ctx.from?.first_name,
    },
    "Message received",
  );

  const userDir = resolve(join(config.dataDir, String(userId)));

  try {
    logger.debug({ userDir }, "Setting up user directory");
    await ensureUserSetup(userDir);

    if (!messageText.trim()) {
      await ctx.reply("Please provide a message.");
      return;
    }

    const sessionId = await getSessionId(userDir);
    logger.debug({ sessionId: sessionId || "new" }, "Session");

    // Send initial status message
    const statusMsg = await ctx.reply("_Processing..._", {
      parse_mode: "Markdown",
    });
    let lastProgressUpdate = Date.now();
    let lastProgressText = "Processing...";

    // Progress callback - updates status message
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

    const downloadsPath = getDownloadsPath(userDir);

    logger.debug("Executing Claude query");
    const result = await executeClaudeQuery({
      prompt: messageText,
      userDir,
      downloadsPath,
      sessionId,
      onProgress,
    });
    logger.debug(
      { success: result.success, error: result.error },
      "Claude result",
    );

    // Delete status message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    } catch {
      // Ignore delete errors
    }

    if (result.sessionId) {
      await saveSessionId(userDir, result.sessionId);
      logger.debug({ sessionId: result.sessionId }, "Session saved");
    }

    const responseText = result.success
      ? result.output
      : result.error || "An error occurred";
    await sendChunkedResponse(ctx, responseText);
    logger.debug("Response sent");

    // Send any files from downloads folder
    const filesSent = await sendDownloadFiles(ctx, userDir);
    if (filesSent > 0) {
      logger.info({ filesSent }, "Sent download files to user");
    }
  } catch (error) {
    logger.error({ error }, "Text handler error");
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(`An error occurred: ${errorMessage}`);
  }
}
