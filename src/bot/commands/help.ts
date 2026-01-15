import type { Context } from "grammy";

export async function helpHandler(ctx: Context): Promise<void> {
  await ctx.reply(
    `*Claude Code Telegram Bot*\n\n` +
      `*Commands:*\n` +
      `/start - Welcome message\n` +
      `/help - Show this help\n` +
      `/clear - Clear conversation history\n\n` +
      `*Usage:*\n` +
      `Just send any message to chat with Claude.\n` +
      `You can also send images and documents for analysis.\n\n` +
      `Your conversation history is preserved between messages. ` +
      `Use /clear to start a fresh conversation.\n\n` +
      `*Configuration:*\n` +
      `Claude reads configuration from your .claude folder.\n` +
      `Edit CLAUDE.md for system prompts and .claude/settings.json for permissions.`,
    { parse_mode: "Markdown" }
  );
}
