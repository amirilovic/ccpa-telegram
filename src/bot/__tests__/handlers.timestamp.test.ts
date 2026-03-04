import type { Context } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeClaudeQuery } from "../../claude/executor.js";
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
import { textHandler } from "../handlers/text.js";

// Mock all dependencies
vi.mock("../../claude/executor.js");
vi.mock("../../config.js");
vi.mock("../../logger.js");
vi.mock("../../user/setup.js");
vi.mock("../../telegram/chunker.js");
vi.mock("../../telegram/fileSender.js");

describe("Message Handlers - Timestamp Extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock config
    vi.mocked(getConfig).mockReturnValue({
      telegram: { botToken: "test-token" },
      access: { allowedUserIds: [] },
      dataDir: "/test/data",
      rateLimit: { max: 100, windowMs: 60000 },
      logging: { level: "info" },
      claude: { command: "claude" },
    });

    // Mock logger
    vi.mocked(getLogger).mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    } as unknown as ReturnType<typeof getLogger>);

    // Mock user setup functions
    vi.mocked(ensureUserSetup).mockResolvedValue();
    vi.mocked(getDownloadsPath).mockReturnValue("/test/downloads");
    vi.mocked(getSessionId).mockResolvedValue("test-session");
    vi.mocked(saveSessionId).mockResolvedValue();

    // Mock executor
    vi.mocked(executeClaudeQuery).mockResolvedValue({
      success: true,
      output: "Test response",
      sessionId: "test-session-new",
    });

    // Mock telegram functions
    vi.mocked(sendChunkedResponse).mockResolvedValue();
    vi.mocked(sendDownloadFiles).mockResolvedValue(0);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Text Handler - Timestamp Extraction", () => {
    it("should extract timestamp from ctx.message.date and pass to executor", async () => {
      const testTimestamp = 1709520000; // March 4, 2024

      const mockContext = {
        from: { id: 123, username: "testuser", first_name: "Test" },
        message: {
          text: "Test message",
          date: testTimestamp,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      await textHandler(mockContext);

      // Verify executeClaudeQuery was called with the timestamp
      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: testTimestamp,
        }),
      );
    });

    it("should handle undefined timestamp gracefully", async () => {
      const mockContext = {
        from: { id: 123, username: "testuser", first_name: "Test" },
        message: {
          text: "Test message",
          // date is undefined
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      await textHandler(mockContext);

      // Verify executeClaudeQuery was called with undefined timestamp
      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: undefined,
        }),
      );
    });

    it("should handle zero timestamp", async () => {
      const mockContext = {
        from: { id: 123, username: "testuser", first_name: "Test" },
        message: {
          text: "Test message",
          date: 0, // Zero timestamp
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      await textHandler(mockContext);

      // Verify executeClaudeQuery was called with zero timestamp
      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: 0,
        }),
      );
    });

    it("should pass all required parameters along with timestamp", async () => {
      const testTimestamp = 1709520000;

      const mockContext = {
        from: { id: 123, username: "testuser", first_name: "Test" },
        message: {
          text: "Test message for Claude",
          date: testTimestamp,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      await textHandler(mockContext);

      // Verify all parameters are passed correctly
      expect(executeClaudeQuery).toHaveBeenCalledWith({
        prompt: "Test message for Claude",
        userDir: expect.stringMatching(/\/test\/data\/123$/),
        downloadsPath: "/test/downloads",
        sessionId: "test-session",
        onProgress: expect.any(Function),
        messageTimestamp: testTimestamp,
      });
    });

    it("should not call executor when message text is missing", async () => {
      const mockContext = {
        from: { id: 123 },
        message: {
          date: 1709520000,
          // text is undefined
        },
        chat: { id: 456 },
      } as unknown as Context;

      await textHandler(mockContext);

      // Should not call executor when text is missing
      expect(executeClaudeQuery).not.toHaveBeenCalled();
    });

    it("should not call executor when user ID is missing", async () => {
      const mockContext = {
        // from is undefined
        message: {
          text: "Test message",
          date: 1709520000,
        },
        chat: { id: 456 },
      } as unknown as Context;

      await textHandler(mockContext);

      // Should not call executor when user ID is missing
      expect(executeClaudeQuery).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    it("should handle negative timestamps correctly", async () => {
      const negativeTimestamp = -86400; // One day before Unix epoch

      const mockContext = {
        from: { id: 123 },
        message: {
          text: "Test message",
          date: negativeTimestamp,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      await textHandler(mockContext);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: negativeTimestamp,
        }),
      );
    });

    it("should handle very large timestamps", async () => {
      const largeTimestamp = 4102444800; // Year 2099

      const mockContext = {
        from: { id: 123 },
        message: {
          text: "Test message",
          date: largeTimestamp,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      await textHandler(mockContext);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: largeTimestamp,
        }),
      );
    });

    it("should continue normal execution flow even with timestamp extraction", async () => {
      const testTimestamp = 1709520000;

      const mockContext = {
        from: { id: 123, username: "testuser" },
        message: {
          text: "Test message",
          date: testTimestamp,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      await textHandler(mockContext);

      // Verify full execution flow
      expect(ensureUserSetup).toHaveBeenCalled();
      expect(getSessionId).toHaveBeenCalled();
      expect(executeClaudeQuery).toHaveBeenCalled();
      expect(sendChunkedResponse).toHaveBeenCalledWith(
        mockContext,
        "Test response",
      );
      expect(sendDownloadFiles).toHaveBeenCalled();
      expect(saveSessionId).toHaveBeenCalledWith(
        expect.any(String),
        "test-session-new",
      );
    });
  });

  describe("Error Handling in Handler", () => {
    it("should handle errors gracefully even when timestamp is present", async () => {
      vi.mocked(executeClaudeQuery).mockRejectedValue(new Error("Test error"));

      const mockContext = {
        from: { id: 123 },
        message: {
          text: "Test message",
          date: 1709520000,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      await textHandler(mockContext);

      // Should have tried to call executor with timestamp
      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: 1709520000,
        }),
      );

      // Should have sent error message to user
      expect(mockContext.reply).toHaveBeenCalledWith(
        "An error occurred: Test error",
      );
    });
  });
});
