import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Context } from "grammy";
import { executeClaudeQuery } from "../../claude/executor.js";
import { parseClaudeOutput } from "../../claude/parser.js";
import { getConfig } from "../../config.js";
import { getLogger } from "../../logger.js";
import { sendChunkedResponse } from "../../telegram/chunker.js";
import { sendDownloadFiles } from "../../telegram/fileSender.js";
import {
  ensureUserSetup,
  getDownloadsPath,
  getSessionId,
  getUploadsPath,
  saveSessionId,
} from "../../user/setup.js";

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/html",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

const SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".js",
  ".ts",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
];

/**
 * Handle document messages (PDFs, images, code files, etc.)
 */
export async function documentHandler(ctx: Context): Promise<void> {
  const config = getConfig();
  const logger = getLogger();
  const userId = ctx.from?.id;
  const document = ctx.message?.document;
  const caption = ctx.message?.caption || "Please analyze this document.";

  if (!userId || !document) {
    return;
  }

  const mimeType = document.mime_type || "";
  const fileName = document.file_name || "document";
  const ext = fileName.includes(".")
    ? `.${fileName.split(".").pop()?.toLowerCase()}`
    : "";

  const isSupported =
    SUPPORTED_MIME_TYPES.includes(mimeType) ||
    SUPPORTED_EXTENSIONS.includes(ext);

  if (!isSupported) {
    await ctx.reply(
      `Unsupported file type. Supported: PDF, images, text, and code files.`,
    );
    return;
  }

  logger.debug({ fileName, mimeType }, "Document received");

  const userDir = resolve(join(config.dataDir, String(userId)));

  try {
    await ensureUserSetup(userDir);

    const file = await ctx.api.getFile(document.file_id);
    const filePath = file.file_path;

    if (!filePath) {
      await ctx.reply("Could not download the document.");
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadsDir = getUploadsPath(userDir);
    const docPath = join(uploadsDir, safeName);
    await writeFile(docPath, buffer);

    logger.debug({ path: docPath }, "Document saved");

    const prompt = `Please read the file "./uploads/${safeName}" and ${caption}`;
    const sessionId = await getSessionId(userDir);

    const statusMsg = await ctx.reply("_Processing..._", {
      parse_mode: "Markdown",
    });
    let lastProgressUpdate = Date.now();
    let lastProgressText = "Processing...";

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

    logger.debug("Executing Claude query with document");
    const result = await executeClaudeQuery({
      prompt,
      userDir,
      downloadsPath,
      sessionId,
      onProgress,
    });

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    } catch {
      // Ignore delete errors
    }

    const parsed = parseClaudeOutput(result);

    if (parsed.sessionId) {
      await saveSessionId(userDir, parsed.sessionId);
    }

    await sendChunkedResponse(ctx, parsed.text);

    // Send any files from downloads folder
    const filesSent = await sendDownloadFiles(ctx, userDir);
    if (filesSent > 0) {
      logger.info({ filesSent }, "Sent download files to user");
    }
  } catch (error) {
    logger.error({ error }, "Document handler error");
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(
      `An error occurred processing the document: ${errorMessage}`,
    );
  }
}
