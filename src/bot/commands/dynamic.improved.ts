import type { Bot, Context } from "grammy";
import { executeClaudeCommand } from "../../claude/commandExecutor.js";
import {
  clearCommandsCache,
  getCommandValidationErrors,
  getValidClaudeCommands,
} from "../../claude/commands.improved.js";
import { getLogger } from "../../logger.js";

// Cache registered command names to avoid duplicate registrations
const registeredCommands: Set<string> = new Set();

/**
 * Register all valid discovered Claude commands with the Telegram bot
 */
export async function registerDynamicCommands(bot: Bot): Promise<void> {
  const logger = getLogger();

  try {
    // Get only valid commands (filtering out conflicts and invalid names)
    const commands = await getValidClaudeCommands();
    const validationErrors = await getCommandValidationErrors();

    if (validationErrors.length > 0) {
      logger.warn(
        {
          errors: validationErrors,
          count: validationErrors.length,
        },
        "Found invalid Claude commands that will be skipped",
      );
    }

    if (commands.length === 0) {
      logger.debug("No valid Claude commands found to register");
      return;
    }

    let registeredCount = 0;
    let skippedCount = 0;

    // Register each valid command
    for (const command of commands) {
      try {
        // Skip if already registered
        if (registeredCommands.has(command.name)) {
          logger.debug(
            { commandName: command.name },
            "Command already registered, skipping",
          );
          skippedCount++;
          continue;
        }

        // Create command handler with improved error handling
        const handler = async (ctx: Context): Promise<void> => {
          try {
            // Extract arguments from the command message
            const messageText = ctx.message?.text || "";
            const commandPattern = new RegExp(`^/${command.name}\\s*(.*)$`);
            const match = messageText.match(commandPattern);
            const args = match?.[1]?.trim() || undefined;

            // Execute the command with error handling
            await executeClaudeCommand(ctx, command.name, args);
          } catch (error) {
            logger.error(
              {
                error,
                commandName: command.name,
                userId: ctx.from?.id,
              },
              "Error in dynamic command handler",
            );

            // Send user-friendly error message
            try {
              await ctx.reply(
                `❌ An error occurred while executing /${command.name}. Please try again later.`,
                { parse_mode: "Markdown" },
              );
            } catch (replyError) {
              // If even the error reply fails, just log it
              logger.error({ error: replyError }, "Failed to send error reply");
            }
          }
        };

        // Register the command with the bot
        bot.command(command.name, handler);
        registeredCommands.add(command.name);
        registeredCount++;

        logger.debug(
          {
            commandName: command.name,
            description: command.description,
            filePath: command.filePath,
          },
          "Registered dynamic Claude command",
        );
      } catch (error) {
        logger.error(
          { error, commandName: command.name },
          "Failed to register individual command",
        );
        skippedCount++;
      }
    }

    logger.info(
      {
        registered: registeredCount,
        skipped: skippedCount,
        invalid: validationErrors.length,
        total: commands.length + validationErrors.length,
      },
      "Dynamic Claude command registration complete",
    );
  } catch (error) {
    logger.error({ error }, "Failed to register dynamic commands");
  }
}

/**
 * Get formatted help text for all valid discovered Claude commands
 */
export async function getDynamicCommandsHelp(): Promise<string> {
  try {
    const commands = await getValidClaudeCommands();

    if (commands.length === 0) {
      return "";
    }

    let help = "*Claude Commands:*\n";

    // Sort commands alphabetically for better UX
    const sortedCommands = commands.sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const command of sortedCommands) {
      const description = command.description || "No description available";
      // Truncate very long descriptions for better formatting
      const truncatedDescription =
        description.length > 80
          ? `${description.slice(0, 77)}...`
          : description;

      help += `/${command.name} - ${truncatedDescription}\n`;
    }

    // Add information about invalid commands if any exist
    const validationErrors = await getCommandValidationErrors();
    if (validationErrors.length > 0) {
      help += `\n_Note: ${validationErrors.length} command(s) skipped due to validation errors._`;
    }

    return help;
  } catch (error) {
    const logger = getLogger();
    logger.error({ error }, "Failed to get dynamic commands help");
    return "";
  }
}

/**
 * Refresh command registration (useful when commands are added/removed)
 */
export async function refreshDynamicCommands(bot: Bot): Promise<void> {
  const logger = getLogger();

  try {
    // Clear caches
    clearCommandsCache();
    registeredCommands.clear();

    logger.info("Cleared command caches, re-registering commands");

    // Re-register commands
    await registerDynamicCommands(bot);
  } catch (error) {
    logger.error({ error }, "Failed to refresh dynamic commands");
  }
}

/**
 * Get registration statistics for monitoring
 */
export async function getDynamicCommandStats(): Promise<{
  registered: number;
  invalid: number;
  errors: Array<{ name: string; error: string }>;
}> {
  try {
    const validCommands = await getValidClaudeCommands();
    const errors = await getCommandValidationErrors();

    return {
      registered: validCommands.length,
      invalid: errors.length,
      errors,
    };
  } catch (error) {
    const logger = getLogger();
    logger.error({ error }, "Failed to get command stats");

    return {
      registered: 0,
      invalid: 0,
      errors: [],
    };
  }
}

/**
 * Check if a command name would conflict with built-in commands
 */
export function wouldConflictWithBuiltIn(commandName: string): boolean {
  // Use the same built-in list from the commands module
  const builtIns = [
    "start",
    "help",
    "clear",
    "stop",
    "restart",
    "settings",
    "version",
    "status",
    "ping",
    "cancel",
  ];
  return builtIns.includes(commandName.toLowerCase());
}

/**
 * Get list of currently registered dynamic command names
 */
export function getRegisteredCommandNames(): string[] {
  return Array.from(registeredCommands).sort();
}
