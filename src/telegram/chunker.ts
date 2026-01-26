import type { Context } from "grammy";

const TELEGRAM_MAX_LENGTH = 4096;
const STREAMING_UPDATE_INTERVAL_MS = 500; // Update every 500ms during streaming

/**
 * Find a safe split point in text, trying to avoid breaking code blocks
 */
function findSafeSplitPoint(text: string, maxLength: number): number {
  if (text.length <= maxLength) {
    return text.length;
  }

  // Try to find a good split point
  const searchText = text.slice(0, maxLength);

  // Try to split at a double newline (paragraph break)
  const doubleNewline = searchText.lastIndexOf("\n\n");
  if (doubleNewline > maxLength * 0.5) {
    return doubleNewline + 2;
  }

  // Try to split at a single newline
  const newline = searchText.lastIndexOf("\n");
  if (newline > maxLength * 0.5) {
    return newline + 1;
  }

  // Try to split at a space
  const space = searchText.lastIndexOf(" ");
  if (space > maxLength * 0.5) {
    return space + 1;
  }

  // Fall back to hard split at max length
  return maxLength;
}

/**
 * Split a long message into chunks that fit Telegram's limits
 */
export function chunkMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    const splitPoint = findSafeSplitPoint(remaining, TELEGRAM_MAX_LENGTH);
    chunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint);
  }

  return chunks;
}

/**
 * Send a potentially long response as multiple messages
 */
export async function sendChunkedResponse(
  ctx: Context,
  text: string,
): Promise<void> {
  const chunks = chunkMessage(text);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Add continuation indicator for multi-part messages
    let messageText = chunk;
    if (chunks.length > 1) {
      if (i === 0) {
        messageText = `${chunk}\n\n_(continued...)_`;
      } else if (i < chunks.length - 1) {
        messageText = `_(part ${i + 1})_\n\n${chunk}\n\n_(continued...)_`;
      } else {
        messageText = `_(part ${i + 1})_\n\n${chunk}`;
      }
    }

    try {
      await ctx.reply(messageText, { parse_mode: "Markdown" });
    } catch {
      // If Markdown fails, try without parsing
      try {
        await ctx.reply(chunk);
      } catch (_error) {
        // Last resort: send error message
        await ctx.reply(`Error sending message part ${i + 1}`);
      }
    }

    // Small delay between chunks to avoid rate limiting
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * Streaming response state management
 */
export interface StreamingResponseState {
  chatId: number;
  messageId: number;
  currentText: string;
  lastUpdateTime: number;
  isComplete: boolean;
  sentChunks: number; // How many overflow chunks we've sent
}

/**
 * Create a new streaming response message
 */
export async function createStreamingResponse(
  ctx: Context,
): Promise<StreamingResponseState | null> {
  if (!ctx.chat?.id) return null;

  const msg = await ctx.reply("_..._", { parse_mode: "Markdown" });

  return {
    chatId: ctx.chat.id,
    messageId: msg.message_id,
    currentText: "",
    lastUpdateTime: Date.now(),
    isComplete: false,
    sentChunks: 0,
  };
}

/**
 * Update streaming response with new text
 * Returns true if update was sent, false if throttled
 */
export async function updateStreamingResponse(
  ctx: Context,
  state: StreamingResponseState,
  newText: string,
  forceUpdate = false,
): Promise<boolean> {
  const now = Date.now();
  const timeSinceLastUpdate = now - state.lastUpdateTime;

  // Throttle updates to avoid hitting Telegram rate limits
  if (!forceUpdate && timeSinceLastUpdate < STREAMING_UPDATE_INTERVAL_MS) {
    return false;
  }

  // If text is the same, skip update
  if (newText === state.currentText) {
    return false;
  }

  state.currentText = newText;
  state.lastUpdateTime = now;

  // Handle text that exceeds Telegram's limit
  // We show the last TELEGRAM_MAX_LENGTH chars in the streaming message
  // and will send full response at the end
  let displayText = newText;
  if (newText.length > TELEGRAM_MAX_LENGTH - 50) {
    // Reserve space for typing indicator
    // Show last portion of text to keep it feeling live
    const truncatedText = newText.slice(-(TELEGRAM_MAX_LENGTH - 100));
    displayText = `_(streaming...)_\n\n${truncatedText}`;
  }

  // Add typing indicator if not complete
  if (!state.isComplete && !displayText.endsWith("_")) {
    displayText = `${displayText} ▌`;
  }

  try {
    await ctx.api.editMessageText(state.chatId, state.messageId, displayText, {
      parse_mode: "Markdown",
    });
    return true;
  } catch {
    // Try without markdown if it fails
    try {
      const plainText = displayText.replace(/[_*`]/g, "");
      await ctx.api.editMessageText(state.chatId, state.messageId, plainText);
      return true;
    } catch {
      // Ignore edit errors (message might be deleted or unchanged)
      return false;
    }
  }
}

/**
 * Finalize streaming response - send complete message
 * If message exceeds one chunk, delete streaming message and send full response
 */
export async function finalizeStreamingResponse(
  ctx: Context,
  state: StreamingResponseState,
  finalText: string,
): Promise<void> {
  state.isComplete = true;
  state.currentText = finalText;

  const chunks = chunkMessage(finalText);

  if (chunks.length === 1) {
    // Single chunk - just update the existing message
    try {
      await ctx.api.editMessageText(state.chatId, state.messageId, finalText, {
        parse_mode: "Markdown",
      });
    } catch {
      // Try without markdown
      try {
        await ctx.api.editMessageText(state.chatId, state.messageId, finalText);
      } catch {
        // If edit fails, send as new message
        await sendChunkedResponse(ctx, finalText);
      }
    }
  } else {
    // Multiple chunks - delete streaming message and send all chunks
    try {
      await ctx.api.deleteMessage(state.chatId, state.messageId);
    } catch {
      // Ignore delete errors
    }

    await sendChunkedResponse(ctx, finalText);
  }
}
