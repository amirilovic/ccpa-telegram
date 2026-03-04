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
}

/**
 * Parse frontmatter from a markdown file
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

  // Simple YAML-like parsing for description
  const lines = frontmatter.split("\n");
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key === "description" && value) {
        data.description = value;
      }
    }
  }

  return { data, content: markdownContent };
}

/**
 * Discover all Claude commands in the working directory
 */
export async function discoverClaudeCommands(): Promise<ClaudeCommand[]> {
  const logger = getLogger();
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

      try {
        const content = await readFile(filePath, "utf-8");
        const { data } = parseFrontmatter(content);

        commands.push({
          name: commandName,
          filePath,
          description: data.description,
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

    logger.info({ count: commands.length }, "Discovered Claude commands");
    return commands;
  } catch (error) {
    // Commands directory doesn't exist or isn't accessible
    logger.debug({ commandsDir, error }, "No Claude commands directory found");
    return [];
  }
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
