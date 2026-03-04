import type { Bot, Context } from "grammy";
import { executeClaudeCommand } from "../../claude/commandExecutor.js";
import { discoverClaudeCommands } from "../../claude/commands.js";
import { getLogger } from "../../logger.js";

/**
 * Register all discovered Claude commands with the Telegram bot
 */
export async function registerDynamicCommands(bot: Bot): Promise<void> {
  const logger = getLogger();

  try {
    const commands = await discoverClaudeCommands();

    if (commands.length === 0) {
      logger.debug("No Claude commands found to register");
      return;
    }

    // Register each discovered command
    for (const command of commands) {
      const handler = async (ctx: Context): Promise<void> => {
        // Extract arguments from the command message
        // For /command arg1 arg2, we get the text after the command
        const messageText = ctx.message?.text || "";
        const commandPattern = new RegExp(`^/${command.name}\\s*(.*)$`);
        const match = messageText.match(commandPattern);
        const args = match?.[1]?.trim() || undefined;

        await executeClaudeCommand(ctx, command.name, args);
      };

      // Register the command with the bot
      bot.command(command.name, handler);

      logger.debug(
        {
          commandName: command.name,
          description: command.description,
        },
        "Registered dynamic Claude command",
      );
    }

    logger.info(
      { count: commands.length },
      "Registered dynamic Claude commands",
    );
  } catch (error) {
    logger.error({ error }, "Failed to register dynamic commands");
  }
}

/**
 * Get formatted help text for all discovered Claude commands
 */
export async function getDynamicCommandsHelp(): Promise<string> {
  try {
    const commands = await discoverClaudeCommands();

    if (commands.length === 0) {
      return "";
    }

    let help = "*Claude Commands:*\n";
    for (const command of commands) {
      const description = command.description || "No description available";
      help += `/${command.name} - ${description}\n`;
    }

    return help;
  } catch (error) {
    const logger = getLogger();
    logger.error({ error }, "Failed to get dynamic commands help");
    return "";
  }
}
