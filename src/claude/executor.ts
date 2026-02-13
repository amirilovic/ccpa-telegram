import { query } from "@anthropic-ai/claude-agent-sdk";
import { getWorkingDirectory } from "../config.js";
import { getLogger } from "../logger.js";

export interface ExecuteOptions {
  prompt: string;
  userDir: string;
  downloadsPath?: string;
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
 * Execute a Claude query using the SDK with streaming progress
 */
export async function executeClaudeQuery(
  options: ExecuteOptions,
): Promise<ExecuteResult> {
  const { prompt, downloadsPath, sessionId, onProgress } = options;
  const logger = getLogger();

  // Append downloads path info to prompt if provided
  const fullPrompt = downloadsPath
    ? `${prompt}\n\n[System: To send files to the user, write them to: ${downloadsPath}]`
    : prompt;

  const cwd = getWorkingDirectory();
  logger.info({ cwd, sessionId }, "Executing Claude query via SDK");

  try {
    const queryOptions = {
      cwd,
      // Resume previous session if we have a session ID
      ...(sessionId ? { resume: sessionId } : {}),
      // Allow permissions based on .claude/settings.json in the working directory
      permissionMode: "acceptEdits" as const,
    };

    logger.debug({ options: queryOptions }, "Starting SDK query");

    const q = query({
      prompt: fullPrompt,
      options: queryOptions,
    });

    let lastResult: ExecuteResult | null = null;
    let currentSessionId: string | undefined;
    let lastAssistantText = ""; // Track last text response for fallback

    // Stream messages from the SDK
    for await (const message of q) {
      logger.debug({ type: message.type }, "Received SDK message");

      // Extract session ID from messages
      if (message.session_id) {
        currentSessionId = message.session_id;
      }

      // Handle assistant messages
      if (message.type === "assistant") {
        // Extract text from assistant messages
        if (message.message?.content) {
          for (const block of message.message.content) {
            // Capture text content for fallback
            if (block.type === "text" && block.text) {
              lastAssistantText = block.text;
            }

            // Send progress updates for tool usage
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

              logger.info({ tool: toolName, input: block.input }, progressMsg);
              if (onProgress) {
                onProgress(progressMsg);
              }
            }
          }
        }

        // Check for errors in assistant messages
        if (message.error) {
          logger.error({ error: message.error }, "Assistant message error");
        }
      }

      // Handle user messages (tool results)
      if (message.type === "user" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "tool_result") {
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

      // Handle result message
      if (message.type === "result") {
        logger.debug({ message }, "Claude result message");

        const isError = message.is_error;
        let output = "";
        let errorMessage: string | undefined;

        if (message.subtype === "success") {
          output = message.result || lastAssistantText || "";
        } else {
          // Error result
          output = lastAssistantText;
          errorMessage =
            message.errors?.join("; ") || `Error: ${message.subtype}`;
        }

        lastResult = {
          success: !isError,
          output,
          sessionId: message.session_id || currentSessionId,
          error: errorMessage,
        };
      }
    }

    // Return the final result
    if (lastResult) {
      if (!lastResult.success) {
        logger.error(
          {
            error: lastResult.error,
            output: lastResult.output?.slice(0, 1000),
          },
          "Claude returned error",
        );
      }
      return lastResult;
    }

    // No result message but query succeeded - use last assistant text
    return {
      success: true,
      output: lastAssistantText || "No response received",
      sessionId: currentSessionId,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, "Claude SDK error");
    return {
      success: false,
      output: "",
      error: `Failed to execute query: ${errorMsg}`,
    };
  }
}
