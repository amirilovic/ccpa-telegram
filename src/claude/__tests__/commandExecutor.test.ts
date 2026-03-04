import type { Context } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../../config.js";
import { getLogger } from "../../logger.js";
import { sendChunkedResponse } from "../../telegram/chunker.js";
import { sendDownloadFiles } from "../../telegram/fileSender.js";
import {
  ensureUserSetup,
  getDownloadsPath,
  getSessionId,
  saveSessionId,
} from "../../user/setup.js";
import { executeClaudeCommand } from "../commandExecutor.js";
import { getClaudeCommand } from "../commands.js";
import { executeClaudeQuery } from "../executor.js";

// Mock dependencies
vi.mock("../commands.js");
vi.mock("../executor.js");
vi.mock("../../config.js");
vi.mock("../../logger.js");
vi.mock("../../user/setup.js");
vi.mock("../../telegram/chunker.js");
vi.mock("../../telegram/fileSender.js");

describe("Command Executor - Integration Tests", () => {
  let mockContext: Context;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock context
    mockContext = {
      from: { id: 123 },
      chat: { id: 456 },
      reply: vi.fn().mockResolvedValue({ message_id: 789 }),
      api: {
        editMessageText: vi.fn().mockResolvedValue({}),
        deleteMessage: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Context;

    // Mock config
    vi.mocked(getConfig).mockReturnValue({
      dataDir: "/test/data",
    } as any);

    // Mock logger
    vi.mocked(getLogger).mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any);

    // Mock user setup functions
    vi.mocked(ensureUserSetup).mockResolvedValue();
    vi.mocked(getDownloadsPath).mockReturnValue("/test/downloads");
    vi.mocked(getSessionId).mockResolvedValue("test-session");
    vi.mocked(saveSessionId).mockResolvedValue();

    // Mock telegram functions
    vi.mocked(sendChunkedResponse).mockResolvedValue();
    vi.mocked(sendDownloadFiles).mockResolvedValue(0);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Successful Command Execution", () => {
    it("should execute Claude command successfully", async () => {
      const mockCommand = {
        name: "test-command",
        filePath: "/test/commands/test-command.md",
        description: "A test command",
        content: "# Test Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "Command executed successfully",
        sessionId: "new-session-123",
      });

      await executeClaudeCommand(mockContext, "test-command", "arg1 arg2");

      // Verify command lookup
      expect(getClaudeCommand).toHaveBeenCalledWith("test-command");

      // Verify user setup
      expect(ensureUserSetup).toHaveBeenCalledWith("/test/data/123");

      // Verify Claude execution with correct prompt
      expect(executeClaudeQuery).toHaveBeenCalledWith({
        prompt: "/test-command arg1 arg2",
        userDir: "/test/data/123",
        downloadsPath: "/test/downloads",
        sessionId: "test-session",
        onProgress: expect.any(Function),
      });

      // Verify response
      expect(sendChunkedResponse).toHaveBeenCalledWith(
        mockContext,
        "Command executed successfully",
      );

      // Verify session save
      expect(saveSessionId).toHaveBeenCalledWith(
        "/test/data/123",
        "new-session-123",
      );

      // Verify files sent
      expect(sendDownloadFiles).toHaveBeenCalledWith(
        mockContext,
        "/test/data/123",
      );
    });

    it("should handle command without arguments", async () => {
      const mockCommand = {
        name: "simple-command",
        filePath: "/test/commands/simple-command.md",
        description: "A simple command",
        content: "# Simple Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "Simple command result",
      });

      await executeClaudeCommand(mockContext, "simple-command");

      expect(executeClaudeQuery).toHaveBeenCalledWith({
        prompt: "/simple-command",
        userDir: "/test/data/123",
        downloadsPath: "/test/downloads",
        sessionId: "test-session",
        onProgress: expect.any(Function),
      });
    });

    it("should handle command with empty arguments", async () => {
      const mockCommand = {
        name: "test-command",
        filePath: "/test/commands/test-command.md",
        description: "A test command",
        content: "# Test Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "Command result",
      });

      await executeClaudeCommand(mockContext, "test-command", "   \t  \n  ");

      expect(executeClaudeQuery).toHaveBeenCalledWith({
        prompt: "/test-command",
        userDir: "/test/data/123",
        downloadsPath: "/test/downloads",
        sessionId: "test-session",
        onProgress: expect.any(Function),
      });
    });

    it("should handle file downloads", async () => {
      const mockCommand = {
        name: "file-command",
        filePath: "/test/commands/file-command.md",
        description: "A command that creates files",
        content: "# File Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "Files created",
        sessionId: "session-with-files",
      });
      vi.mocked(sendDownloadFiles).mockResolvedValue(3);

      await executeClaudeCommand(mockContext, "file-command", "create files");

      expect(sendDownloadFiles).toHaveBeenCalledWith(
        mockContext,
        "/test/data/123",
      );
      expect(getLogger().info).toHaveBeenCalledWith(
        { filesSent: 3, commandName: "file-command" },
        "Sent download files to user",
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle command not found", async () => {
      vi.mocked(getClaudeCommand).mockResolvedValue(null);

      await executeClaudeCommand(mockContext, "nonexistent-command");

      expect(mockContext.reply).toHaveBeenCalledWith(
        "❌ Command `nonexistent-command` not found.",
        { parse_mode: "Markdown" },
      );

      // Should not proceed with execution
      expect(executeClaudeQuery).not.toHaveBeenCalled();
    });

    it("should handle missing user ID", async () => {
      const mockCommand = {
        name: "test-command",
        filePath: "/test/commands/test-command.md",
        description: "A test command",
        content: "# Test Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);

      const mockContextNoUser = {
        from: undefined,
        chat: { id: 456 },
        reply: vi.fn(),
      } as unknown as Context;

      await executeClaudeCommand(mockContextNoUser, "test-command");

      expect(mockContextNoUser.reply).toHaveBeenCalledWith(
        "❌ Unable to identify user.",
      );
      expect(executeClaudeQuery).not.toHaveBeenCalled();
    });

    it("should handle Claude execution failure", async () => {
      const mockCommand = {
        name: "failing-command",
        filePath: "/test/commands/failing-command.md",
        description: "A command that fails",
        content: "# Failing Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: false,
        output: "",
        error: "Claude execution failed",
      });

      await executeClaudeCommand(mockContext, "failing-command", "test args");

      expect(sendChunkedResponse).toHaveBeenCalledWith(
        mockContext,
        "Claude execution failed",
      );

      expect(getLogger().info).toHaveBeenCalledWith(
        expect.objectContaining({
          commandName: "failing-command",
          args: "test args",
          userId: 123,
          success: false,
        }),
        "Claude command executed",
      );
    });

    it("should handle user setup failure", async () => {
      const mockCommand = {
        name: "test-command",
        filePath: "/test/commands/test-command.md",
        description: "A test command",
        content: "# Test Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(ensureUserSetup).mockRejectedValue(new Error("Setup failed"));

      await executeClaudeCommand(mockContext, "test-command");

      expect(mockContext.reply).toHaveBeenCalledWith(
        expect.stringMatching(
          /❌ Failed to execute command `test-command`.*Setup failed/s,
        ),
        { parse_mode: "Markdown" },
      );

      expect(getLogger().error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          commandName: "test-command",
        }),
        "Failed to execute Claude command",
      );
    });

    it("should handle executeClaudeQuery exception", async () => {
      const mockCommand = {
        name: "exception-command",
        filePath: "/test/commands/exception-command.md",
        description: "A command that throws",
        content: "# Exception Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockRejectedValue(
        new Error("Execution threw exception"),
      );

      await executeClaudeCommand(mockContext, "exception-command", "test");

      expect(mockContext.reply).toHaveBeenCalledWith(
        "❌ Failed to execute command `exception-command`.\n\nError: Execution threw exception",
        { parse_mode: "Markdown" },
      );
    });
  });

  describe("Progress Handling", () => {
    it("should show and update progress messages", async () => {
      const mockCommand = {
        name: "long-command",
        filePath: "/test/commands/long-command.md",
        description: "A long running command",
        content: "# Long Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);

      let progressCallback: ((message: string) => void) | undefined;

      vi.mocked(executeClaudeQuery).mockImplementation(async (options) => {
        progressCallback = options.onProgress;
        return {
          success: true,
          output: "Long command completed",
        };
      });

      const executePromise = executeClaudeCommand(mockContext, "long-command");

      // Wait a bit for initial setup
      await new Promise((resolve) => setTimeout(resolve, 1));

      // Verify initial status message
      expect(mockContext.reply).toHaveBeenCalledWith("_Executing command..._", {
        parse_mode: "Markdown",
      });

      // Test progress updates
      if (progressCallback) {
        await progressCallback("Reading files...");
        await progressCallback("Processing data...");
      }

      await executePromise;

      // Verify status message deletion
      expect(mockContext.api.deleteMessage).toHaveBeenCalledWith(456, 789);
    });

    it("should handle status message edit failures gracefully", async () => {
      const mockCommand = {
        name: "test-command",
        filePath: "/test/commands/test-command.md",
        description: "A test command",
        content: "# Test Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(mockContext.api.editMessageText).mockRejectedValue(
        new Error("Edit failed"),
      );

      let progressCallback: ((message: string) => void) | undefined;

      vi.mocked(executeClaudeQuery).mockImplementation(async (options) => {
        progressCallback = options.onProgress;
        return { success: true, output: "Done" };
      });

      const executePromise = executeClaudeCommand(mockContext, "test-command");

      await new Promise((resolve) => setTimeout(resolve, 1));

      // Should not throw when edit fails
      if (progressCallback) {
        await expect(
          progressCallback("Progress update"),
        ).resolves.toBeUndefined();
      }

      await executePromise;
    });

    it("should throttle progress updates", async () => {
      const mockCommand = {
        name: "test-command",
        filePath: "/test/commands/test-command.md",
        description: "A test command",
        content: "# Test Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);

      // Mock Date.now to simulate time passage
      let currentTime = 1000000000; // baseline time
      const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
        return currentTime;
      });

      let progressCallback: ((message: string) => void) | undefined;

      vi.mocked(executeClaudeQuery).mockImplementation(async (options) => {
        progressCallback = options.onProgress;
        return { success: true, output: "Done" };
      });

      const executePromise = executeClaudeCommand(mockContext, "test-command");

      await new Promise((resolve) => setTimeout(resolve, 1));

      if (progressCallback) {
        // First update: advance time by 3000ms (> 2000ms threshold) and different message
        currentTime += 3000;
        await progressCallback("Update 1");

        // Subsequent updates: rapid fire (no time advancement) should be throttled
        await progressCallback("Update 2");
        await progressCallback("Update 3");

        // Should only edit message once due to throttling
        expect(mockContext.api.editMessageText).toHaveBeenCalledTimes(1);
        expect(mockContext.api.editMessageText).toHaveBeenCalledWith(
          456,
          789,
          "_Update 1_",
          { parse_mode: "Markdown" },
        );
      }

      await executePromise;

      // Restore Date.now
      dateNowSpy.mockRestore();
    });
  });

  describe("Session Management", () => {
    it("should use existing session ID", async () => {
      const mockCommand = {
        name: "session-command",
        filePath: "/test/commands/session-command.md",
        description: "A command with session",
        content: "# Session Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(getSessionId).mockResolvedValue("existing-session-456");
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "Session command result",
      });

      await executeClaudeCommand(mockContext, "session-command");

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "existing-session-456",
        }),
      );
    });

    it("should handle missing session ID", async () => {
      const mockCommand = {
        name: "no-session-command",
        filePath: "/test/commands/no-session-command.md",
        description: "A command without session",
        content: "# No Session Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(getSessionId).mockResolvedValue(null);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "No session result",
      });

      await executeClaudeCommand(mockContext, "no-session-command");

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: null,
        }),
      );

      // Should not try to save session if none returned
      expect(saveSessionId).not.toHaveBeenCalled();
    });

    it("should save new session ID when returned", async () => {
      const mockCommand = {
        name: "new-session-command",
        filePath: "/test/commands/new-session-command.md",
        description: "A command that creates new session",
        content: "# New Session Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "New session created",
        sessionId: "brand-new-session",
      });

      await executeClaudeCommand(mockContext, "new-session-command");

      expect(saveSessionId).toHaveBeenCalledWith(
        "/test/data/123",
        "brand-new-session",
      );
      expect(getLogger().debug).toHaveBeenCalledWith(
        { sessionId: "brand-new-session" },
        "Session saved",
      );
    });
  });

  describe("Edge Cases and Input Validation", () => {
    it("should handle commands with special characters in arguments", async () => {
      const mockCommand = {
        name: "special-command",
        filePath: "/test/commands/special-command.md",
        description: "Command with special chars",
        content: "# Special Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "Special chars handled",
      });

      const specialArgs =
        'arg with spaces "quoted arg" --flag=value $var @mention #hashtag';
      await executeClaudeCommand(mockContext, "special-command", specialArgs);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: `/special-command ${specialArgs}`,
        }),
      );
    });

    it("should handle very long command arguments", async () => {
      const mockCommand = {
        name: "long-args-command",
        filePath: "/test/commands/long-args-command.md",
        description: "Command with long args",
        content: "# Long Args Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "Long args processed",
      });

      const longArgs = "a".repeat(1000);
      await executeClaudeCommand(mockContext, "long-args-command", longArgs);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: `/long-args-command ${longArgs}`,
        }),
      );
    });

    it("should handle Unicode characters in arguments", async () => {
      const mockCommand = {
        name: "unicode-command",
        filePath: "/test/commands/unicode-command.md",
        description: "Command with unicode",
        content: "# Unicode Command",
      };

      vi.mocked(getClaudeCommand).mockResolvedValue(mockCommand);
      vi.mocked(executeClaudeQuery).mockResolvedValue({
        success: true,
        output: "Unicode handled",
      });

      const unicodeArgs = "Hello 世界 🌍 émojis and ñoñó";
      await executeClaudeCommand(mockContext, "unicode-command", unicodeArgs);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: `/unicode-command ${unicodeArgs}`,
        }),
      );
    });
  });
});
