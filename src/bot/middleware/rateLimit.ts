import type { Context, NextFunction } from "grammy";
import { getConfig } from "../../config.js";

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-memory store for rate limiting
const rateLimitStore = new Map<number, RateLimitEntry>();

/**
 * Clean up expired entries periodically
 */
function cleanupExpiredEntries(): void {
  const config = getConfig();
  const now = Date.now();

  for (const [userId, entry] of rateLimitStore) {
    if (now - entry.windowStart > config.rateLimit.windowMs) {
      rateLimitStore.delete(userId);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredEntries, 60000);

/**
 * Middleware to rate limit requests per user
 */
export async function rateLimitMiddleware(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  const config = getConfig();
  const userId = ctx.from?.id;

  if (!userId) {
    await next();
    return;
  }

  const now = Date.now();
  const entry = rateLimitStore.get(userId);

  if (entry) {
    // Check if window has expired
    if (now - entry.windowStart > config.rateLimit.windowMs) {
      // Reset window
      rateLimitStore.set(userId, { count: 1, windowStart: now });
      await next();
      return;
    }

    // Check if limit exceeded
    if (entry.count >= config.rateLimit.max) {
      const remainingMs = config.rateLimit.windowMs - (now - entry.windowStart);
      const remainingSec = Math.ceil(remainingMs / 1000);

      await ctx.reply(
        `Rate limit exceeded. Please wait ${remainingSec} seconds before sending another message.`,
      );
      return;
    }

    // Increment count
    entry.count++;
  } else {
    // First request in window
    rateLimitStore.set(userId, { count: 1, windowStart: now });
  }

  await next();
}
