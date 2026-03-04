import type { Context } from "grammy";
import { getDynamicCommandsHelp } from "./dynamic.js";

export async function helpHandler(ctx: Context): Promise<void> {
  const dynamicHelp = await getDynamicCommandsHelp();

  const helpText =
    `*Claude Code Telegram Bot*\n\n` +
    `*Built-in Commands:*\n` +
    `/start - Welcome message\n` +
    `/help - Show this help\n` +
    `/clear - Clear conversation history\n\n` +
    (dynamicHelp ? `${dynamicHelp}\n` : "") +
    `*Usage:*\n` +
    `Just send any message to chat with Claude.\n` +
    `You can also send images and documents for analysis.\n\n` +
    `Your conversation history is preserved between messages. ` +
    `Use /clear to start a fresh conversation.\n\n` +
    `*Configuration:*\n` +
    `Claude reads configuration from your .claude folder.\n` +
    `Edit CLAUDE.md for system prompts and .claude/settings.json for permissions.`;

  await ctx.reply(helpText, { parse_mode: "Markdown" });
}
