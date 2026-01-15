import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";
import { getLogger } from "./logger.js";

// Working directory - set by CLI
let workingDirectory: string = process.cwd();

/**
 * Initialize the configuration with a working directory
 */
export function initConfig(cwd: string): void {
  workingDirectory = resolve(cwd);

  // Only load .env from the working directory (don't traverse up)
  const envPath = join(workingDirectory, ".env");
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
  }
  // Don't fall back to default behavior - only use explicit working directory

  // Reset config instance to force reload
  configInstance = null;
}

/**
 * Get the working directory
 */
export function getWorkingDirectory(): string {
  return workingDirectory;
}

const ConfigSchema = z.object({
  telegram: z.object({
    botToken: z.string().min(1, "telegram.botToken is required"),
  }),
  access: z.object({
    allowedUserIds: z.array(z.number()),
  }),
  dataDir: z.string().default(".ccpa/users"),
  rateLimit: z.object({
    max: z.number().positive().default(10),
    windowMs: z.number().positive().default(60000),
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
  claude: z.object({
    command: z.string().default("claude"),
  }),
});

// Schema for the config file (all fields optional)
const ConfigFileSchema = z
  .object({
    telegram: z
      .object({
        botToken: z.string(),
      })
      .partial()
      .optional(),
    access: z
      .object({
        allowedUserIds: z.array(z.number()),
      })
      .partial()
      .optional(),
    dataDir: z.string().optional(),
    rateLimit: z
      .object({
        max: z.number().positive(),
        windowMs: z.number().positive(),
      })
      .partial()
      .optional(),
    logging: z
      .object({
        level: z.enum(["debug", "info", "warn", "error"]),
      })
      .partial()
      .optional(),
    claude: z
      .object({
        command: z.string(),
      })
      .partial()
      .optional(),
  })
  .partial();

export type Config = z.infer<typeof ConfigSchema>;

function parseAllowedUserIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => {
      const num = parseInt(id, 10);
      if (Number.isNaN(num)) {
        throw new Error(`Invalid user ID: ${id}`);
      }
      return num;
    });
}

function loadConfigFile(): z.infer<typeof ConfigFileSchema> {
  const configPath = join(workingDirectory, "ccpa.config.json");

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content);
    const result = ConfigFileSchema.safeParse(parsed);

    if (!result.success) {
      getLogger().error(
        { error: result.error.format() },
        "Invalid ccpa.config.json",
      );
      return {};
    }

    getLogger().info({ path: configPath }, "Loaded configuration");
    return result.data;
  } catch (error) {
    getLogger().error({ error }, "Failed to read ccpa.config.json");
    return {};
  }
}

export function loadConfig(): Config {
  // Load config file first
  const fileConfig = loadConfigFile();

  // Build config with file values as defaults, env vars as overrides
  const rawConfig = {
    telegram: {
      botToken:
        process.env.TELEGRAM_BOT_TOKEN || fileConfig.telegram?.botToken || "",
    },
    access: {
      allowedUserIds: process.env.ALLOWED_USER_IDS
        ? parseAllowedUserIds(process.env.ALLOWED_USER_IDS)
        : fileConfig.access?.allowedUserIds || [],
    },
    dataDir: process.env.DATA_DIR || fileConfig.dataDir || ".ccpa/users",
    rateLimit: {
      max: process.env.RATE_LIMIT_MAX
        ? parseInt(process.env.RATE_LIMIT_MAX, 10)
        : fileConfig.rateLimit?.max || 10,
      windowMs: process.env.RATE_LIMIT_WINDOW_MS
        ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
        : fileConfig.rateLimit?.windowMs || 60000,
    },
    logging: {
      level: process.env.LOG_LEVEL || fileConfig.logging?.level || "info",
    },
    claude: {
      command:
        process.env.CLAUDE_COMMAND || fileConfig.claude?.command || "claude",
    },
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    getLogger().error(
      { error: result.error.format() },
      "Configuration validation failed",
    );
    process.exit(1);
  }

  // Make dataDir absolute relative to working directory
  const config = result.data;
  config.dataDir = resolve(workingDirectory, config.dataDir);

  return config;
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
