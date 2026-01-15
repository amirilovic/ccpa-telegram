import type { Context } from "grammy";

export async function startHandler(ctx: Context): Promise<void> {
  const username = ctx.from?.first_name || "there";

  await ctx.reply(
    `Hello ${username}! I'm a Claude Code assistant bot.\n\n` +
      `You can:\n` +
      `- Send any message to chat with me\n` +
      `- Send images or documents for analysis\n` +
      `- Use /clear to start a new conversation\n\n` +
      `Type /help for more information.`
  );
}
