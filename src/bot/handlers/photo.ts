import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Context } from "grammy";
import { executeClaudeQueryStreaming } from "../../claude/executor.js";
import { parseClaudeOutput } from "../../claude/parser.js";
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
  getUploadsPath,
  saveSessionId,
} from "../../user/setup.js";

/**
 * Handle photo messages with streaming response
 */
export async function photoHandler(ctx: Context): Promise<void> {
  const config = getConfig();
  const logger = getLogger();
  const userId = ctx.from?.id;
  const photo = ctx.message?.photo;
  const caption = ctx.message?.caption || "Please analyze this image.";

  if (!userId || !photo || photo.length === 0) {
    return;
  }

  logger.debug({ userId }, "Photo received");

  const userDir = resolve(join(config.dataDir, String(userId)));

  try {
    await ensureUserSetup(userDir);

    // Get the largest photo (last in array)
    const largestPhoto = photo[photo.length - 1];
    const file = await ctx.api.getFile(largestPhoto.file_id);
    const filePath = file.file_path;

    if (!filePath) {
      await ctx.reply("Could not download the image.");
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    const ext = filePath.split(".").pop() || "jpg";
    const imageName = `image_${Date.now()}.${ext}`;
    const uploadsDir = getUploadsPath(userDir);
    const imagePath = join(uploadsDir, imageName);
    await writeFile(imagePath, buffer);

    logger.debug({ path: imagePath }, "Image saved");

    const prompt = `Please look at the image file "./uploads/${imageName}" and ${caption}`;
    const sessionId = await getSessionId(userDir);

    // Create streaming response
    const streamingState = await createStreamingResponse(ctx);
    if (!streamingState) {
      await ctx.reply("Failed to initialize response.");
      return;
    }

    let lastProgressUpdate = Date.now();
    let lastProgressText = "";
    let hasReceivedText = false;

    const onProgress = async (message: string) => {
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

    const onTextChunk = async (_newChunk: string, fullText: string) => {
      hasReceivedText = true;
      await updateStreamingResponse(ctx, streamingState, fullText);
    };

    const downloadsPath = getDownloadsPath(userDir);

    logger.debug("Executing Claude query with image (streaming)");
    const result = await executeClaudeQueryStreaming({
      prompt,
      userDir,
      downloadsPath,
      sessionId,
      onProgress,
      onTextChunk,
    });

    const parsed = parseClaudeOutput(result);

    if (parsed.sessionId) {
      await saveSessionId(userDir, parsed.sessionId);
    }

    // Finalize the streaming response
    await finalizeStreamingResponse(ctx, streamingState, parsed.text);

    // Send any files from downloads folder
    const filesSent = await sendDownloadFiles(ctx, userDir);
    if (filesSent > 0) {
      logger.info({ filesSent }, "Sent download files to user");
    }
  } catch (error) {
    logger.error({ error }, "Photo handler error");
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(`An error occurred processing the image: ${errorMessage}`);
  }
}
