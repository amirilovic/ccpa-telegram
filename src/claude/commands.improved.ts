import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { getWorkingDirectory } from "../config.js";
import { getLogger } from "../logger.js";

export interface ClaudeCommand {
  /** Command name (filename without .md) */
  name: string;
  /** Full file path */
  filePath: string;
  /** Description from frontmatter */
  description?: string;
  /** Raw command content */
  content: string;
  /** Whether command name is valid (doesn't conflict with built-ins) */
  isValid: boolean;
  /** Validation error message if invalid */
  validationError?: string;
}

// Cache for discovered commands to avoid repeated filesystem operations
let commandsCache: ClaudeCommand[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Built-in Telegram bot commands that should not be overridden
const BUILT_IN_COMMANDS = new Set([
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
]);

/**
 * Validate command name to prevent conflicts and security issues
 */
function validateCommandName(name: string): {
  isValid: boolean;
  error?: string;
} {
  // Check for built-in command conflicts
  if (BUILT_IN_COMMANDS.has(name)) {
    return {
      isValid: false,
      error: `Command '${name}' conflicts with built-in command`,
    };
  }

  // Check for valid characters (alphanumeric, hyphens, underscores, dots)
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return {
      isValid: false,
      error: `Command '${name}' contains invalid characters. Use only letters, numbers, hyphens, underscores, and dots.`,
    };
  }

  // Check reasonable length limits
  if (name.length < 1) {
    return {
      isValid: false,
      error: "Command name cannot be empty",
    };
  }

  if (name.length > 64) {
    return {
      isValid: false,
      error: `Command '${name}' is too long (max 64 characters)`,
    };
  }

  // Prevent command names that start/end with special chars
  if (/^[._-]|[._-]$/.test(name)) {
    return {
      isValid: false,
      error: `Command '${name}' cannot start or end with dots, hyphens, or underscores`,
    };
  }

  return { isValid: true };
}

/**
 * Sanitize description text to prevent injection attacks
 */
function sanitizeDescription(description: string): string {
  // Remove or escape potentially dangerous characters
  return description
    .replace(/[<>]/g, "") // Remove HTML-like brackets
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters
    .trim()
    .slice(0, 200); // Limit length to prevent abuse
}

/**
 * Parse frontmatter from a markdown file with improved error handling
 */
function parseFrontmatter(content: string): {
  data: Record<string, any>;
  content: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { data: {}, content };
  }

  const [, frontmatter, markdownContent] = match;
  const data: Record<string, any> = {};

  try {
    // Simple YAML-like parsing for description with improved safety
    const lines = frontmatter.split("\n");
    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();

        // Remove quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        if (key === "description" && value) {
          // Sanitize description for security
          data.description = sanitizeDescription(value);
        }
      }
    }
  } catch (error) {
    // If frontmatter parsing fails, log warning but continue
    const logger = getLogger();
    logger.warn({ error, frontmatter }, "Failed to parse frontmatter");
  }

  return { data, content: markdownContent };
}

/**
 * Clear the commands cache (useful for testing or when commands change)
 */
export function clearCommandsCache(): void {
  commandsCache = null;
  cacheTimestamp = 0;
}

/**
 * Check if cache is still valid
 */
function isCacheValid(): boolean {
  return commandsCache !== null && Date.now() - cacheTimestamp < CACHE_DURATION;
}

/**
 * Discover all Claude commands in the working directory with caching and validation
 */
export async function discoverClaudeCommands(): Promise<ClaudeCommand[]> {
  const logger = getLogger();

  // Return cached commands if cache is still valid
  if (isCacheValid()) {
    logger.debug(
      { cached: true, count: commandsCache!.length },
      "Using cached Claude commands",
    );
    return commandsCache!;
  }

  const workingDir = getWorkingDirectory();
  const commandsDir = join(workingDir, ".claude", "commands");

  try {
    const files = await readdir(commandsDir);
    const commands: ClaudeCommand[] = [];
    const validationErrors: string[] = [];

    for (const file of files) {
      if (extname(file) !== ".md") {
        continue;
      }

      const filePath = join(commandsDir, file);
      const commandName = basename(file, ".md");

      // Validate command name
      const validation = validateCommandName(commandName);
      let command: ClaudeCommand;

      try {
        const content = await readFile(filePath, "utf-8");
        const { data } = parseFrontmatter(content);

        command = {
          name: commandName,
          filePath,
          description: data.description,
          content,
          isValid: validation.isValid,
          validationError: validation.error,
        };

        commands.push(command);

        if (validation.isValid) {
          logger.debug(
            { commandName, description: data.description },
            "Discovered valid Claude command",
          );
        } else {
          validationErrors.push(validation.error!);
          logger.warn(
            { commandName, error: validation.error },
            "Discovered invalid Claude command",
          );
        }
      } catch (error) {
        logger.warn({ file, error }, "Failed to read Claude command file");
      }
    }

    // Log summary with validation results
    const validCommands = commands.filter((cmd) => cmd.isValid);
    const invalidCommands = commands.filter((cmd) => !cmd.isValid);

    logger.info(
      {
        total: commands.length,
        valid: validCommands.length,
        invalid: invalidCommands.length,
        validationErrors:
          validationErrors.length > 0 ? validationErrors : undefined,
      },
      "Discovered Claude commands with validation",
    );

    // Cache the results
    commandsCache = commands;
    cacheTimestamp = Date.now();

    return commands;
  } catch (error) {
    // Commands directory doesn't exist or isn't accessible
    logger.debug({ commandsDir, error }, "No Claude commands directory found");

    // Cache empty result to avoid repeated filesystem attempts
    commandsCache = [];
    cacheTimestamp = Date.now();

    return [];
  }
}

/**
 * Get valid Claude commands only (filtering out invalid ones)
 */
export async function getValidClaudeCommands(): Promise<ClaudeCommand[]> {
  const allCommands = await discoverClaudeCommands();
  return allCommands.filter((cmd) => cmd.isValid);
}

/**
 * Get a specific Claude command by name with caching
 */
export async function getClaudeCommand(
  commandName: string,
): Promise<ClaudeCommand | null> {
  // Use cached commands for lookup to avoid repeated filesystem operations
  const commands = await discoverClaudeCommands();
  return commands.find((cmd) => cmd.name === commandName) || null;
}

/**
 * Get a specific valid Claude command by name
 */
export async function getValidClaudeCommand(
  commandName: string,
): Promise<ClaudeCommand | null> {
  const command = await getClaudeCommand(commandName);
  return command?.isValid ? command : null;
}

/**
 * Get command validation errors for debugging
 */
export async function getCommandValidationErrors(): Promise<
  Array<{ name: string; error: string }>
> {
  const commands = await discoverClaudeCommands();
  return commands
    .filter((cmd) => !cmd.isValid)
    .map((cmd) => ({ name: cmd.name, error: cmd.validationError! }));
}
