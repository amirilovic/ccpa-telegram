import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { getWorkingDirectory } from "../config.js";
import { getLogger } from "../logger.js";

/**
 * Built-in Telegram bot commands that cannot be overridden
 */
const RESERVED_COMMANDS = new Set(["start", "help", "clear", "dynamic"]);

/**
 * Cache for discovered commands to improve performance
 */
let commandCache: ClaudeCommand[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

export interface ClaudeCommand {
  /** Command name (filename without .md) */
  name: string;
  /** Full file path */
  filePath: string;
  /** Description from frontmatter */
  description?: string;
  /** Raw command content */
  content: string;
}

/**
 * Validate that a command name doesn't conflict with built-in commands
 */
function validateCommandName(
  commandName: string,
  logger: ReturnType<typeof import("../logger.js").getLogger>,
): boolean {
  if (RESERVED_COMMANDS.has(commandName)) {
    logger.warn(
      { commandName, reserved: Array.from(RESERVED_COMMANDS) },
      `Skipping Claude command '${commandName}' - conflicts with built-in command`,
    );
    return false;
  }

  // Additional validation for command name format
  if (!/^[a-zA-Z0-9._-]+$/.test(commandName)) {
    logger.warn(
      { commandName },
      `Skipping Claude command '${commandName}' - invalid command name format`,
    );
    return false;
  }

  return true;
}

/**
 * Parse frontmatter from a markdown file
 */
function parseFrontmatter(
  content: string,
  logger: ReturnType<typeof import("../logger.js").getLogger>,
): {
  data: Record<string, unknown>;
  content: string;
  warnings?: string[];
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { data: {}, content };
  }

  const [, frontmatter, markdownContent] = match;
  const data: Record<string, unknown> = {};
  const warnings: string[] = [];

  try {
    // Simple YAML-like parsing for description
    const lines = frontmatter.split("\n");
    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        if (key === "description" && value) {
          // Remove quotes if present
          const cleanValue = value.replace(/^["']|["']$/g, "");
          if (cleanValue.length === 0) {
            warnings.push("Empty description found");
          } else if (cleanValue.length > 200) {
            warnings.push("Description is very long (>200 chars)");
          } else {
            data.description = cleanValue;
          }
        }
      }
    }
  } catch (error) {
    logger.warn({ error }, "Error parsing frontmatter");
    warnings.push("Failed to parse frontmatter");
  }

  if (warnings.length > 0) {
    logger.debug({ warnings }, "Frontmatter parsing warnings");
  }

  return { data, content: markdownContent, warnings };
}

/**
 * Discover all Claude commands in the working directory
 */
export async function discoverClaudeCommands(
  forceRefresh = false,
): Promise<ClaudeCommand[]> {
  const logger = getLogger();

  // Check cache validity
  const now = Date.now();
  if (
    !forceRefresh &&
    commandCache !== null &&
    now - cacheTimestamp < CACHE_TTL
  ) {
    logger.debug(
      { cacheAge: now - cacheTimestamp },
      "Using cached Claude commands",
    );
    return commandCache;
  }

  const workingDir = getWorkingDirectory();
  const commandsDir = join(workingDir, ".claude", "commands");

  try {
    const files = await readdir(commandsDir);
    const commands: ClaudeCommand[] = [];

    for (const file of files) {
      if (extname(file) !== ".md") {
        continue;
      }

      const filePath = join(commandsDir, file);
      const commandName = basename(file, ".md");

      // Validate command name before processing
      if (!validateCommandName(commandName, logger)) {
        continue;
      }

      try {
        const content = await readFile(filePath, "utf-8");
        const { data, warnings: _warnings } = parseFrontmatter(content, logger);

        commands.push({
          name: commandName,
          filePath,
          description:
            typeof data.description === "string" ? data.description : undefined,
          content,
        });

        logger.debug(
          { commandName, description: data.description },
          "Discovered Claude command",
        );
      } catch (error) {
        logger.warn({ file, error }, "Failed to read Claude command file");
      }
    }

    // Update cache
    commandCache = commands;
    cacheTimestamp = now;

    logger.info({ count: commands.length }, "Discovered Claude commands");
    return commands;
  } catch (error) {
    // Commands directory doesn't exist or isn't accessible
    logger.debug({ commandsDir, error }, "No Claude commands directory found");

    // Cache empty result to avoid repeated filesystem checks
    commandCache = [];
    cacheTimestamp = now;
    return [];
  }
}

/**
 * Clear the command cache (useful for testing or manual refresh)
 */
export function clearCommandCache(): void {
  commandCache = null;
  cacheTimestamp = 0;
}

/**
 * Get the list of reserved command names
 */
export function getReservedCommands(): string[] {
  return Array.from(RESERVED_COMMANDS);
}

/**
 * Get a specific Claude command by name
 */
export async function getClaudeCommand(
  commandName: string,
): Promise<ClaudeCommand | null> {
  const commands = await discoverClaudeCommands();
  return commands.find((cmd) => cmd.name === commandName) || null;
}
