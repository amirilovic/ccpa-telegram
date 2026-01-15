import type { Context } from "grammy";

const TELEGRAM_MAX_LENGTH = 4096;

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
  text: string
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
      } catch (error) {
        // Last resort: send error message
        await ctx.reply(`Error sending message part ${i + 1}`);
      }
    }

    // Small delay between chunks to avoid rate limiting
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
