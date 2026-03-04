import { exec } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import type { Context } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeClaudeQuery } from "../../claude/executor.js";
import { parseClaudeOutput } from "../../claude/parser.js";
import { getConfig } from "../../config.js";
import { getLogger } from "../../logger.js";
import { sendChunkedResponse } from "../../telegram/chunker.js";
import { sendDownloadFiles } from "../../telegram/fileSender.js";
import { transcribeAudio } from "../../transcription/whisper.js";
import {
  ensureUserSetup,
  getDownloadsPath,
  getSessionId,
  getUploadsPath,
  saveSessionId,
} from "../../user/setup.js";
import { documentHandler } from "../handlers/document.js";
import { photoHandler } from "../handlers/photo.js";
import { textHandler } from "../handlers/text.js";
import { voiceHandler } from "../handlers/voice.js";

// Mock all dependencies
vi.mock("../../claude/executor.js");
vi.mock("../../config.js");
vi.mock("../../logger.js");
vi.mock("../../user/setup.js");
vi.mock("../../telegram/chunker.js");
vi.mock("../../telegram/fileSender.js");
vi.mock("../../transcription/whisper.js");
vi.mock("../../claude/parser.js");
vi.mock("node:fs/promises");
vi.mock("node:child_process");

describe("Message Handlers - Timestamp Extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock config
    vi.mocked(getConfig).mockReturnValue({
      dataDir: "/test/data",
      telegram: {
        botToken: "test-bot-token",
      },
      transcription: {
        showTranscription: false,
      },
    } as any);

    // Mock logger
    vi.mocked(getLogger).mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    } as any);

    // Mock user setup functions
    vi.mocked(ensureUserSetup).mockResolvedValue();
    vi.mocked(getDownloadsPath).mockReturnValue("/test/downloads");
    vi.mocked(getUploadsPath).mockReturnValue("/test/uploads");
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

    // Mock additional functions for other handlers
    vi.mocked(transcribeAudio).mockResolvedValue({ text: "Transcribed text" });
    vi.mocked(parseClaudeOutput).mockReturnValue({
      text: "Parsed response",
      sessionId: "parsed-session-id",
    });

    // Mock file operations
    vi.mocked(writeFile).mockResolvedValue();
    vi.mocked(unlink).mockResolvedValue();

    // Mock child_process (for ffmpeg in voice handler)
    vi.mocked(exec).mockImplementation((...args: any[]) => {
      // Get the callback which is typically the last argument
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        // Simulate successful ffmpeg execution
        process.nextTick(() => callback(null, "ffmpeg success", ""));
      }
      return {} as any;
    });
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

  describe("Voice Handler - Timestamp Extraction", () => {
    it("should extract timestamp from voice message and pass to executor", async () => {
      const testTimestamp = 1709520000; // March 4, 2024

      const mockContext = {
        from: { id: 123, username: "testuser", first_name: "Test" },
        message: {
          voice: { file_id: "voice123", duration: 10, file_size: 5000 },
          date: testTimestamp,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "voice/test.oga" }),
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      // Mock global fetch
      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as any);

      await voiceHandler(mockContext);

      // Verify executeClaudeQuery was called with the timestamp
      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: testTimestamp,
        }),
      );
    });

    it("should handle undefined timestamp in voice message", async () => {
      const mockContext = {
        from: { id: 123 },
        message: {
          voice: { file_id: "voice123", duration: 10, file_size: 5000 },
          // date is undefined
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "voice/test.oga" }),
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as any);

      await voiceHandler(mockContext);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: undefined,
        }),
      );
    });
  });

  describe("Document Handler - Timestamp Extraction", () => {
    it("should extract timestamp from document message and pass to executor", async () => {
      const testTimestamp = 1709520000; // March 4, 2024

      const mockContext = {
        from: { id: 123 },
        message: {
          document: {
            file_id: "doc123",
            file_name: "test.pdf",
            mime_type: "application/pdf",
          },
          caption: "Analyze this document",
          date: testTimestamp,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "docs/test.pdf" }),
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as any);

      await documentHandler(mockContext);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: testTimestamp,
        }),
      );
    });

    it("should handle undefined timestamp in document message", async () => {
      const mockContext = {
        from: { id: 123 },
        message: {
          document: {
            file_id: "doc123",
            file_name: "test.pdf",
            mime_type: "application/pdf",
          },
          caption: "Analyze this document",
          // date is undefined
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "docs/test.pdf" }),
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as any);

      await documentHandler(mockContext);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: undefined,
        }),
      );
    });
  });

  describe("Photo Handler - Timestamp Extraction", () => {
    it("should extract timestamp from photo message and pass to executor", async () => {
      const testTimestamp = 1709520000; // March 4, 2024

      const mockContext = {
        from: { id: 123 },
        message: {
          photo: [{ file_id: "photo123", width: 1920, height: 1080 }],
          caption: "What's in this image?",
          date: testTimestamp,
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "photos/test.jpg" }),
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as any);

      await photoHandler(mockContext);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: testTimestamp,
        }),
      );
    });

    it("should handle undefined timestamp in photo message", async () => {
      const mockContext = {
        from: { id: 123 },
        message: {
          photo: [{ file_id: "photo123", width: 1920, height: 1080 }],
          caption: "What's in this image?",
          // date is undefined
        },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue({ message_id: 789 }),
        api: {
          getFile: vi.fn().mockResolvedValue({ file_path: "photos/test.jpg" }),
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
      } as unknown as Context;

      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as any);

      await photoHandler(mockContext);

      expect(executeClaudeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          messageTimestamp: undefined,
        }),
      );
    });
  });
});
