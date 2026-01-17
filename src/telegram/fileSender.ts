import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "grammy";
import { InputFile } from "grammy";
import { getLogger } from "../logger.js";
import { getDownloadsPath } from "../user/setup.js";

/**
 * Send all files from the user's downloads folder and delete them after sending
 * Returns the number of files sent
 */
export async function sendDownloadFiles(
  ctx: Context,
  userDir: string,
): Promise<number> {
  const logger = getLogger();
  const downloadsPath = getDownloadsPath(userDir);

  let files: string[];
  try {
    files = await readdir(downloadsPath);
  } catch {
    // Directory doesn't exist or can't be read
    return 0;
  }

  if (files.length === 0) {
    return 0;
  }

  let sentCount = 0;

  for (const fileName of files) {
    const filePath = join(downloadsPath, fileName);

    try {
      // Send the file
      await ctx.replyWithDocument(new InputFile(filePath, fileName));
      logger.info({ fileName }, "Sent file to user");

      // Delete the file after successful send
      await unlink(filePath);
      logger.debug({ fileName }, "Deleted sent file");

      sentCount++;
    } catch (error) {
      logger.error(
        { error, fileName },
        "Failed to send file, keeping it for retry",
      );
      // Don't delete on failure - keep for potential retry
    }

    // Small delay between files to avoid rate limiting
    if (sentCount < files.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return sentCount;
}
