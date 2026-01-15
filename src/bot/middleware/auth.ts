import type { Context, NextFunction } from "grammy";
import { getConfig } from "../../config.js";

/**
 * Middleware to check if user is in the whitelist
 */
export async function authMiddleware(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  const config = getConfig();
  const userId = ctx.from?.id;

  // Allow if no whitelist is configured (open access)
  if (config.access.allowedUserIds.length === 0) {
    await next();
    return;
  }

  // Check if user is in whitelist
  if (userId && config.access.allowedUserIds.includes(userId)) {
    await next();
    return;
  }

  // User not authorized
  await ctx.reply(
    "Sorry, you are not authorized to use this bot.\n" +
      "Contact the administrator to request access.",
  );
}
