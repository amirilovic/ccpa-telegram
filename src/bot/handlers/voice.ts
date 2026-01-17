import { exec } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Context } from "grammy";
import { executeClaudeQuery } from "../../claude/executor.js";
import { parseClaudeOutput } from "../../claude/parser.js";
import { getConfig } from "../../config.js";
import { getLogger } from "../../logger.js";
import { sendChunkedResponse } from "../../telegram/chunker.js";
import { sendDownloadFiles } from "../../telegram/fileSender.js";
import { transcribeAudio } from "../../transcription/whisper.js";
import {
  ensureUserSetup,
  getDownloadsPath,
  getSessionId,
  getUploadsPath,
  saveSessionId,
} from "../../user/setup.js";

const execAsync = promisify(exec);

/**
 * Convert OGA/OGG (Opus) to WAV for Whisper compatibility
 */
async function convertToWav(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const logger = getLogger();
  try {
    await execAsync(
      `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -y "${outputPath}"`,
    );
    logger.debug({ inputPath, outputPath }, "Audio converted to WAV");
  } catch (error) {
    logger.error({ error }, "ffmpeg conversion failed");
    throw new Error(
      "Failed to convert audio. Ensure ffmpeg is installed: brew install ffmpeg",
    );
  }
}

/**
 * Handle voice messages - transcribe and route to Claude
 */
export async function voiceHandler(ctx: Context): Promise<void> {
  const config = getConfig();
  const logger = getLogger();
  const userId = ctx.from?.id;
  const voice = ctx.message?.voice;

  if (!userId || !voice) {
    return;
  }

  logger.debug(
    { userId, duration: voice.duration, fileSize: voice.file_size },
    "Voice message received",
  );

  const userDir = resolve(join(config.dataDir, String(userId)));

  try {
    await ensureUserSetup(userDir);

    // Download voice file from Telegram
    const file = await ctx.api.getFile(voice.file_id);
    const filePath = file.file_path;

    if (!filePath) {
      await ctx.reply("Could not download the voice message.");
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Save original OGA file
    const timestamp = Date.now();
    const uploadsDir = getUploadsPath(userDir);
    const ogaPath = join(uploadsDir, `voice_${timestamp}.oga`);
    const wavPath = join(uploadsDir, `voice_${timestamp}.wav`);
    await writeFile(ogaPath, buffer);

    logger.debug({ path: ogaPath }, "Voice file saved");

    // Send transcribing status
    const statusMsg = await ctx.reply("_Transcribing voice message..._", {
      parse_mode: "Markdown",
    });

    // Convert to WAV (Whisper requires WAV/MP3 input)
    await convertToWav(ogaPath, wavPath);

    // Transcribe with local Whisper
    const transcription = await transcribeAudio(wavPath);

    if (!transcription.text) {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id);
      await ctx.reply(
        "Could not transcribe the voice message. Please try again.",
      );
      return;
    }

    // Optionally show transcription to user
    if (config.transcription?.showTranscription) {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          `_Transcribed: "${transcription.text}"_\n\n_Processing with Claude..._`,
          { parse_mode: "Markdown" },
        );
      } catch {
        // Ignore edit errors
      }
    } else {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          "_Processing..._",
          { parse_mode: "Markdown" },
        );
      } catch {
        // Ignore edit errors
      }
    }

    // Clean up temporary files
    try {
      await unlink(ogaPath);
      await unlink(wavPath);
    } catch {
      // Ignore cleanup errors
    }

    // Send transcribed text to Claude
    const sessionId = await getSessionId(userDir);
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

    logger.debug(
      { transcription: transcription.text },
      "Executing Claude query",
    );
    const result = await executeClaudeQuery({
      prompt: transcription.text,
      userDir,
      downloadsPath,
      sessionId,
      onProgress,
    });

    // Delete status message
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
    logger.error({ error }, "Voice handler error");
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await ctx.reply(
      `An error occurred processing the voice message: ${errorMessage}`,
    );
  }
}
