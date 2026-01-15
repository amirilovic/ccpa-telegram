import type { ExecuteResult } from "./executor.js";

export interface ParsedResponse {
  text: string;
  sessionId?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Parse Claude CLI JSON output and extract the result text
 */
export function parseClaudeOutput(result: ExecuteResult): ParsedResponse {
  if (!result.success) {
    return {
      text: result.error || "An unknown error occurred",
    };
  }

  try {
    // Claude CLI with --output-format json returns structured JSON
    const parsed = JSON.parse(result.output);

    // Extract the result text
    // The structure may vary, but typically contains a 'result' or 'message' field
    let text = "";

    if (typeof parsed === "string") {
      text = parsed;
    } else if (parsed.result) {
      text = parsed.result;
    } else if (parsed.message) {
      text = parsed.message;
    } else if (parsed.content) {
      // Handle content array format
      if (Array.isArray(parsed.content)) {
        text = parsed.content
          .filter((block: unknown) => {
            const b = block as { type?: string };
            return b.type === "text";
          })
          .map((block: unknown) => {
            const b = block as { text?: string };
            return b.text || "";
          })
          .join("\n");
      } else {
        text = String(parsed.content);
      }
    } else {
      // Fallback: stringify the entire response
      text = JSON.stringify(parsed, null, 2);
    }

    return {
      text: text || "No response received",
      sessionId: parsed.session_id,
      costUsd: parsed.cost_usd,
      inputTokens: parsed.input_tokens,
      outputTokens: parsed.output_tokens,
    };
  } catch {
    // If JSON parsing fails, return the raw output
    // This handles cases where Claude returns plain text
    return {
      text: result.output || "No response received",
    };
  }
}
