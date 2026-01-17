import { existsSync } from "node:fs";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";

// Dynamic import for optional dependency
let whisperModule: typeof import("nodejs-whisper") | null = null;

async function getWhisper() {
  if (!whisperModule) {
    try {
      whisperModule = await import("nodejs-whisper");
    } catch {
      throw new Error(
        "nodejs-whisper is not installed. Run: pnpm add nodejs-whisper",
      );
    }
  }
  return whisperModule;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Transcribe audio file using local Whisper model
 */
export async function transcribeAudio(
  audioPath: string,
): Promise<TranscriptionResult> {
  const logger = getLogger();
  const config = getConfig();

  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const whisper = await getWhisper();
  const modelName = config.transcription?.model || "base.en";

  logger.debug({ audioPath, model: modelName }, "Starting transcription");

  const startTime = Date.now();

  try {
    const transcript = await whisper.nodewhisper(audioPath, {
      modelName,
      autoDownloadModelName: modelName,
      removeWavFileAfterTranscription: false,
      withCuda: false,
      whisperOptions: {
        outputInText: true,
        language: "auto",
      },
      logger: {
        debug: (message: string) => logger.debug(message),
        error: (message: string) => logger.error(message),
        log: (message: string) => logger.info(message),
      },
    });

    const duration = (Date.now() - startTime) / 1000;
    const text = Array.isArray(transcript)
      ? transcript.map((t) => t.speech).join(" ")
      : String(transcript);

    logger.debug(
      { duration: `${duration.toFixed(2)}s`, textLength: text.length },
      "Transcription complete",
    );

    return {
      text: text.trim(),
      duration,
    };
  } catch (error) {
    logger.error({ error, audioPath }, "Transcription failed");
    throw error;
  }
}
