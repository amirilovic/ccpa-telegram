import { join } from "node:path";
import type { Context } from "grammy";
import { getConfig } from "../../config.js";
import { clearUserData } from "../../user/setup.js";

export async function clearHandler(ctx: Context): Promise<void> {
  const config = getConfig();
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply("Could not identify user.");
    return;
  }

  const userDir = join(config.dataDir, String(userId));

  try {
    await clearUserData(userDir);
    await ctx.reply(
      "Conversation history cleared. Your next message will start a fresh conversation.",
    );
  } catch (_error) {
    await ctx.reply("Failed to clear conversation history. Please try again.");
  }
}
