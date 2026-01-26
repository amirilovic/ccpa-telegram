import { join, resolve } from "node:path";
import type { Context } from "grammy";
import { executeClaudeQueryStreaming } from "../../claude/executor.js";
import { getConfig } from "../../config.js";
import { getLogger } from "../../logger.js";
import {
  createStreamingResponse,
  finalizeStreamingResponse,
  updateStreamingResponse,
} from "../../telegram/chunker.js";
import { sendDownloadFiles } from "../../telegram/fileSender.js";
import {
  ensureUserSetup,
  getDownloadsPath,
  getSessionId,
  saveSessionId,
} from "../../user/setup.js";

/**
 * Handle text messages - routes to Claude with streaming response
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

    // Create streaming response message
    const streamingState = await createStreamingResponse(ctx);
    if (!streamingState) {
      await ctx.reply("Failed to initialize response.");
      return;
    }

    let lastProgressUpdate = Date.now();
    let lastProgressText = "";
    let hasReceivedText = false;

    // Progress callback - updates status message when doing tools
    const onProgress = async (message: string) => {
      // Only show progress if we haven't started receiving text yet
      if (hasReceivedText) return;

      const now = Date.now();
      if (now - lastProgressUpdate > 1000 && message !== lastProgressText) {
        lastProgressUpdate = now;
        lastProgressText = message;
        try {
          await ctx.api.editMessageText(
            streamingState.chatId,
            streamingState.messageId,
            `_${message}_`,
            { parse_mode: "Markdown" },
          );
        } catch {
          // Ignore edit errors
        }
      }
    };

    // Text streaming callback - updates message with incoming text
    const onTextChunk = async (_newChunk: string, fullText: string) => {
      hasReceivedText = true;
      await updateStreamingResponse(ctx, streamingState, fullText);
    };

    const downloadsPath = getDownloadsPath(userDir);

    logger.debug("Executing Claude query with streaming");
    const result = await executeClaudeQueryStreaming({
      prompt: messageText,
      userDir,
      downloadsPath,
      sessionId,
      onProgress,
      onTextChunk,
    });
    logger.debug(
      { success: result.success, error: result.error },
      "Claude result",
    );

    if (result.sessionId) {
      await saveSessionId(userDir, result.sessionId);
      logger.debug({ sessionId: result.sessionId }, "Session saved");
    }

    const responseText = result.success
      ? result.output
      : result.error || "An error occurred";

    // Finalize the streaming response with the complete text
    await finalizeStreamingResponse(ctx, streamingState, responseText);
    logger.debug("Streaming response finalized");

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
