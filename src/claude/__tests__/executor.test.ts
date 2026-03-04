import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, getWorkingDirectory } from "../../config.js";
import { getLogger } from "../../logger.js";
import { executeClaudeQuery } from "../executor.js";

// Mock dependencies
vi.mock("node:child_process");
vi.mock("../../config.js");
vi.mock("../../logger.js");

// Create a mock child process
const createMockChildProcess = () => {
  const mockProcess = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  } as unknown as ChildProcess;

  return mockProcess;
};

describe("executeClaudeQuery - Timestamp Functionality", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock config
    vi.mocked(getConfig).mockReturnValue({
      claude: { command: "claude-test" },
      dataDir: "/test/data",
    } as any);

    // Mock working directory
    vi.mocked(getWorkingDirectory).mockReturnValue("/test/cwd");

    // Mock logger
    vi.mocked(getLogger).mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("System Context Building", () => {
    it("should include timestamp in system context when messageTimestamp is provided", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      // Setup process to return successful result
      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      const testTimestamp = 1709520000; // Unix timestamp in seconds
      const expectedIsoString = "2024-03-04T02:40:00.000Z";

      executeClaudeQuery({
        prompt: "Test prompt",
        userDir: "/test/user",
        messageTimestamp: testTimestamp,
      });

      // Wait for spawn to be called
      await new Promise((resolve) => setTimeout(resolve, 1));

      // Check that spawn was called with correct arguments
      expect(spawn).toHaveBeenCalledWith(
        "claude-test",
        expect.arrayContaining([
          "-p",
          `Test prompt\n\n[System: Message timestamp: ${expectedIsoString} (${testTimestamp})]`,
          "--output-format",
          "stream-json",
          "--verbose",
        ]),
        expect.any(Object),
      );
    });

    it("should include both downloads path and timestamp when both are provided", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      const testTimestamp = 1709520000;
      const expectedIsoString = "2024-03-04T02:40:00.000Z";
      const downloadsPath = "/test/downloads";

      executeClaudeQuery({
        prompt: "Test prompt",
        userDir: "/test/user",
        downloadsPath,
        messageTimestamp: testTimestamp,
      });

      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(spawn).toHaveBeenCalledWith(
        "claude-test",
        expect.arrayContaining([
          "-p",
          `Test prompt\n\n[System: To send files to the user, write them to: ${downloadsPath} | Message timestamp: ${expectedIsoString} (${testTimestamp})]`,
        ]),
        expect.any(Object),
      );
    });

    it("should not include timestamp in system context when messageTimestamp is undefined", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      executeClaudeQuery({
        prompt: "Test prompt",
        userDir: "/test/user",
        // messageTimestamp is undefined
      });

      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(spawn).toHaveBeenCalledWith(
        "claude-test",
        expect.arrayContaining([
          "-p",
          "Test prompt", // No system context appended
        ]),
        expect.any(Object),
      );
    });

    it("should not include timestamp when messageTimestamp is 0", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      executeClaudeQuery({
        prompt: "Test prompt",
        userDir: "/test/user",
        messageTimestamp: 0, // Falsy value
      });

      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(spawn).toHaveBeenCalledWith(
        "claude-test",
        expect.arrayContaining([
          "-p",
          "Test prompt", // No system context for timestamp
        ]),
        expect.any(Object),
      );
    });
  });

  describe("Timestamp Conversion and Formatting", () => {
    it("should correctly convert Unix timestamp to ISO string", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      // Test various timestamp values
      const testCases = [
        {
          timestamp: 1709520000,
          expectedIso: "2024-03-04T02:40:00.000Z",
          description: "Standard timestamp",
        },
        {
          timestamp: 0,
          expectedIso: "1970-01-01T00:00:00.000Z",
          description: "Unix epoch",
        },
        {
          timestamp: 1893456000,
          expectedIso: "2030-01-01T00:00:00.000Z",
          description: "Future timestamp",
        },
      ];

      for (const testCase of testCases) {
        vi.clearAllMocks();

        // Skip timestamp 0 since it's handled as falsy
        if (testCase.timestamp === 0) continue;

        executeClaudeQuery({
          prompt: "Test prompt",
          userDir: "/test/user",
          messageTimestamp: testCase.timestamp,
        });

        await new Promise((resolve) => setTimeout(resolve, 1));

        expect(spawn).toHaveBeenCalledWith(
          "claude-test",
          expect.arrayContaining([
            "-p",
            expect.stringContaining(
              `Message timestamp: ${testCase.expectedIso} (${testCase.timestamp})`,
            ),
          ]),
          expect.any(Object),
        );
      }
    });

    it("should handle edge case timestamps correctly", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      // Test very large timestamp (year 2099)
      const largeTimestamp = 4102444800; // 2099-12-31
      executeClaudeQuery({
        prompt: "Test prompt",
        userDir: "/test/user",
        messageTimestamp: largeTimestamp,
      });

      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(spawn).toHaveBeenCalledWith(
        "claude-test",
        expect.arrayContaining([
          "-p",
          expect.stringContaining(
            `Message timestamp: 2100-01-01T00:00:00.000Z (${largeTimestamp})`,
          ),
        ]),
        expect.any(Object),
      );
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle negative timestamps", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      // Negative timestamp should still work (before Unix epoch)
      const negativeTimestamp = -86400; // One day before epoch
      executeClaudeQuery({
        prompt: "Test prompt",
        userDir: "/test/user",
        messageTimestamp: negativeTimestamp,
      });

      await new Promise((resolve) => setTimeout(resolve, 1));

      // Should still create ISO string (1969-12-31T00:00:00.000Z)
      expect(spawn).toHaveBeenCalledWith(
        "claude-test",
        expect.arrayContaining([
          "-p",
          expect.stringContaining(
            "Message timestamp: 1969-12-31T00:00:00.000Z",
          ),
        ]),
        expect.any(Object),
      );
    });

    it("should handle very small positive timestamps", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      // Small positive timestamp should work
      const smallTimestamp = 1;
      executeClaudeQuery({
        prompt: "Test prompt",
        userDir: "/test/user",
        messageTimestamp: smallTimestamp,
      });

      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(spawn).toHaveBeenCalledWith(
        "claude-test",
        expect.arrayContaining([
          "-p",
          expect.stringContaining(
            "Message timestamp: 1970-01-01T00:00:01.000Z (1)",
          ),
        ]),
        expect.any(Object),
      );
    });
  });

  describe("Integration with Other Options", () => {
    it("should maintain all other executor functionality when timestamp is provided", async () => {
      const { spawn } = await import("node:child_process");
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      mockProcess.on = vi.fn((event, callback) => {
        if (event === "close") {
          setTimeout(() => callback(0), 0);
        }
        return mockProcess;
      });

      const options = {
        prompt: "Test prompt",
        userDir: "/test/user",
        downloadsPath: "/test/downloads",
        sessionId: "test-session-123",
        messageTimestamp: 1709520000,
        onProgress: vi.fn(),
      };

      executeClaudeQuery(options);

      await new Promise((resolve) => setTimeout(resolve, 1));

      // Verify all CLI arguments are present
      expect(spawn).toHaveBeenCalledWith(
        "claude-test",
        [
          "-p",
          expect.stringContaining("Test prompt"),
          "--output-format",
          "stream-json",
          "--verbose",
          "--resume",
          "test-session-123",
        ],
        expect.objectContaining({
          cwd: "/test/cwd",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );

      // Verify prompt includes both downloads path and timestamp
      const callArgs = vi.mocked(spawn).mock.calls[0][1];
      const promptArg = callArgs[callArgs.indexOf("-p") + 1];
      expect(promptArg).toContain(
        "To send files to the user, write them to: /test/downloads",
      );
      expect(promptArg).toContain(
        "Message timestamp: 2024-03-04T02:40:00.000Z (1709520000)",
      );
    });
  });
});
