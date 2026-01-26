import { spawn } from "node:child_process";
import { getConfig, getWorkingDirectory } from "../config.js";
import { getLogger } from "../logger.js";

export interface ExecuteOptions {
  prompt: string;
  userDir: string;
  downloadsPath?: string;
  sessionId?: string | null;
  onProgress?: (message: string) => void;
}

export interface StreamingExecuteOptions extends ExecuteOptions {
  onTextChunk?: (text: string, fullText: string) => void;
}

export interface ExecuteResult {
  success: boolean;
  output: string;
  sessionId?: string;
  error?: string;
}

/**
 * Execute a Claude query using the CLI with streaming text output
 * This version calls onTextChunk as soon as text is available
 */
export async function executeClaudeQueryStreaming(
  options: StreamingExecuteOptions,
): Promise<ExecuteResult> {
  const { prompt, downloadsPath, sessionId, onProgress, onTextChunk } = options;
  const logger = getLogger();

  // Append downloads path info to prompt if provided
  const fullPrompt = downloadsPath
    ? `${prompt}\n\n[System: To send files to the user, write them to: ${downloadsPath}]`
    : prompt;

  const args: string[] = [
    "-p",
    fullPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // Resume previous session if we have a session ID
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  const claudeCommand = getConfig().claude.command;
  const cwd = getWorkingDirectory();
  logger.info(
    { command: claudeCommand, args, cwd },
    "Executing Claude CLI (streaming)",
  );

  return new Promise((resolve) => {
    const proc = spawn(claudeCommand, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrOutput = "";
    let lastResult: ExecuteResult | null = null;
    let currentSessionId: string | undefined;
    let accumulatedText = ""; // Accumulated text from all assistant messages
    let isProcessingTools = false; // Track if we're in tool processing mode

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();

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

          // Extract text from assistant messages
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              // Capture and stream text content immediately
              if (block.type === "text" && block.text) {
                // Only accumulate if we haven't seen this exact text before
                // Claude streams incrementally, so we get the full text each time
                if (block.text.length > accumulatedText.length) {
                  const newText = block.text;

                  // If we were processing tools, this is new text after tools
                  if (!isProcessingTools) {
                    accumulatedText = newText;
                    if (onTextChunk) {
                      onTextChunk(newText, accumulatedText);
                    }
                  }
                }
              }

              // Send progress updates for tool usage
              if (block.type === "tool_use") {
                isProcessingTools = true;
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

                logger.info(
                  { tool: toolName, input: block.input },
                  progressMsg,
                );
                if (onProgress) {
                  onProgress(progressMsg);
                }
              }
            }
          }

          // Log tool results and mark tool processing as done
          if (event.type === "user" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "tool_result") {
                isProcessingTools = false;
                const result =
                  typeof block.content === "string"
                    ? block.content.slice(0, 500)
                    : JSON.stringify(block.content).slice(0, 500);
                logger.info(
                  { toolUseId: block.tool_use_id, isError: block.is_error },
                  `Tool result: ${result}${result.length >= 500 ? "..." : ""}`,
                );
              }
            }
          }

          // Capture the final result
          if (event.type === "result") {
            logger.debug({ event }, "Claude result event");
            // Error can be in event.result or event.errors array
            const errorMessage = event.is_error
              ? event.result ||
                (event.errors?.length ? event.errors.join("; ") : undefined)
              : undefined;
            lastResult = {
              success: !event.is_error,
              output: event.result || accumulatedText,
              sessionId: event.session_id || currentSessionId,
              error: errorMessage,
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
        stderrOutput += `${chunk}\n`;
        logger.debug({ stderr: chunk }, "Claude stderr");
      }
    });

    proc.on("close", (code) => {
      logger.debug({ code }, "Claude process closed");

      if (lastResult) {
        if (!lastResult.success) {
          logger.error(
            {
              error: lastResult.error,
              output: lastResult.output?.slice(0, 1000),
              stderr: stderrOutput,
            },
            "Claude returned error",
          );
        }
        resolve(lastResult);
      } else if (code === 0) {
        // No result event but process succeeded - use accumulated text
        resolve({
          success: true,
          output: accumulatedText || "No response received",
          sessionId: currentSessionId,
        });
      } else {
        const errorMsg =
          stderrOutput.trim() || `Claude exited with code ${code}`;
        logger.error(
          { code, stderr: stderrOutput, lastText: accumulatedText },
          "Claude process failed",
        );
        resolve({
          success: false,
          output: accumulatedText,
          error: errorMsg,
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

/**
 * Execute a Claude query using the CLI with streaming progress
 * (Original non-streaming version for backwards compatibility)
 */
export async function executeClaudeQuery(
  options: ExecuteOptions,
): Promise<ExecuteResult> {
  return executeClaudeQueryStreaming(options);
}
