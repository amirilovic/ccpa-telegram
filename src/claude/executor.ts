import { spawn } from "node:child_process";
import { getConfig, getWorkingDirectory } from "../config.js";
import { getLogger } from "../logger.js";

export interface ExecuteOptions {
  prompt: string;
  userDir: string;
  sessionId?: string | null;
  onProgress?: (message: string) => void;
}

export interface ExecuteResult {
  success: boolean;
  output: string;
  sessionId?: string;
  error?: string;
}

/**
 * Execute a Claude query using the CLI with streaming progress
 */
export async function executeClaudeQuery(
  options: ExecuteOptions,
): Promise<ExecuteResult> {
  const { prompt, userDir, sessionId, onProgress } = options;
  const logger = getLogger();

  const args: string[] = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // Resume previous session if we have a session ID
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  const claudeCommand = getConfig().claude.command;
  logger.debug(
    { command: claudeCommand, args, userDir },
    "Executing Claude CLI",
  );

  return new Promise((resolve) => {
    const proc = spawn(claudeCommand, args, {
      cwd: getWorkingDirectory(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let fullOutput = "";
    let lastResult: ExecuteResult | null = null;
    let currentSessionId: string | undefined;

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      fullOutput += chunk;

      // Parse streaming JSON lines
      const lines = chunk.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const event = JSON.parse(line);

          // Extract session ID from init message
          if (
            event.type === "system" &&
            event.subtype === "init" &&
            event.session_id
          ) {
            currentSessionId = event.session_id;
          }

          // Send progress updates for tool usage
          if (
            event.type === "assistant" &&
            event.message?.content &&
            onProgress
          ) {
            for (const block of event.message.content) {
              if (block.type === "tool_use") {
                const toolName = block.name || "unknown";
                let progressMsg = `Using ${toolName}...`;

                // Add more context for specific tools
                if (toolName === "Read" && block.input?.file_path) {
                  progressMsg = `Reading: ${block.input.file_path}`;
                } else if (toolName === "Grep" && block.input?.pattern) {
                  progressMsg = `Searching for: ${block.input.pattern}`;
                } else if (toolName === "Glob" && block.input?.pattern) {
                  progressMsg = `Finding files: ${block.input.pattern}`;
                } else if (toolName === "Bash" && block.input?.command) {
                  const cmd = block.input.command.slice(0, 50);
                  progressMsg = `Running: ${cmd}${block.input.command.length > 50 ? "..." : ""}`;
                } else if (toolName === "Edit" && block.input?.file_path) {
                  progressMsg = `Editing: ${block.input.file_path}`;
                } else if (toolName === "Write" && block.input?.file_path) {
                  progressMsg = `Writing: ${block.input.file_path}`;
                } else if (toolName === "WebSearch" && block.input?.query) {
                  progressMsg = `Searching web: ${block.input.query}`;
                } else if (toolName === "WebFetch" && block.input?.url) {
                  progressMsg = `Fetching: ${block.input.url}`;
                }

                onProgress(progressMsg);
              }
            }
          }

          // Capture the final result
          if (event.type === "result") {
            lastResult = {
              success: !event.is_error,
              output: event.result || "",
              sessionId: event.session_id || currentSessionId,
              error: event.is_error ? event.result : undefined,
            };
          }
        } catch {
          // Not valid JSON, ignore
        }
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString().trim();
      if (chunk) {
        logger.debug({ stderr: chunk }, "Claude stderr");
      }
    });

    proc.on("close", (code) => {
      logger.debug({ code }, "Claude process closed");

      if (lastResult) {
        resolve(lastResult);
      } else if (code === 0) {
        resolve({
          success: true,
          output: fullOutput,
          sessionId: currentSessionId,
        });
      } else {
        resolve({
          success: false,
          output: fullOutput,
          error: `Claude exited with code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      logger.error({ error: err.message }, "Claude process error");
      resolve({
        success: false,
        output: "",
        error: `Failed to start ${claudeCommand}: ${err.message}`,
      });
    });
  });
}
