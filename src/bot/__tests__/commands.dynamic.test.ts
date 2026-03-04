import type { Bot, Context } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeClaudeCommand } from "../../claude/commandExecutor.js";
import { discoverClaudeCommands } from "../../claude/commands.js";
import { getLogger } from "../../logger.js";
import {
  getDynamicCommandsHelp,
  registerDynamicCommands,
} from "../commands/dynamic.js";

// Mock dependencies
vi.mock("../../claude/commands.js");
vi.mock("../../claude/commandExecutor.js");
vi.mock("../../logger.js");

describe("Dynamic Commands - Registration and Help", () => {
  let mockBot: Bot;
  let mockContext: Context;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock bot
    mockBot = {
      command: vi.fn(),
    } as unknown as Bot;

    // Mock context
    mockContext = {
      message: {
        text: "/test-command arg1 arg2",
      },
    } as unknown as Context;

    // Mock logger
    vi.mocked(getLogger).mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any);

    // Mock command executor
    vi.mocked(executeClaudeCommand).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("registerDynamicCommands", () => {
    it("should register discovered commands with the bot", async () => {
      const mockCommands = [
        {
          name: "test-command",
          filePath: "/test/commands/test-command.md",
          description: "A test command",
          content: "# Test Command",
        },
        {
          name: "another-command",
          filePath: "/test/commands/another-command.md",
          description: "Another test command",
          content: "# Another Command",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      await registerDynamicCommands(mockBot);

      // Verify bot.command was called for each discovered command
      expect(mockBot.command).toHaveBeenCalledTimes(2);
      expect(mockBot.command).toHaveBeenCalledWith(
        "test-command",
        expect.any(Function),
      );
      expect(mockBot.command).toHaveBeenCalledWith(
        "another-command",
        expect.any(Function),
      );

      // Verify logging
      expect(getLogger().debug).toHaveBeenCalledWith(
        expect.objectContaining({
          commandName: "test-command",
          description: "A test command",
        }),
        "Registered dynamic Claude command",
      );

      expect(getLogger().info).toHaveBeenCalledWith(
        { count: 2 },
        "Registered dynamic Claude commands",
      );
    });

    it("should handle no commands found", async () => {
      vi.mocked(discoverClaudeCommands).mockResolvedValue([]);

      await registerDynamicCommands(mockBot);

      expect(mockBot.command).not.toHaveBeenCalled();
      expect(getLogger().debug).toHaveBeenCalledWith(
        "No Claude commands found to register",
      );
    });

    it("should handle registration errors gracefully", async () => {
      const error = new Error("Registration failed");
      vi.mocked(discoverClaudeCommands).mockRejectedValue(error);

      await registerDynamicCommands(mockBot);

      expect(mockBot.command).not.toHaveBeenCalled();
      expect(getLogger().error).toHaveBeenCalledWith(
        { error },
        "Failed to register dynamic commands",
      );
    });

    it("should create proper command handlers", async () => {
      const mockCommands = [
        {
          name: "test-command",
          filePath: "/test/commands/test-command.md",
          description: "A test command",
          content: "# Test Command",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      await registerDynamicCommands(mockBot);

      // Get the registered handler
      const handlerCall = vi.mocked(mockBot.command).mock.calls[0];
      const [commandName, handler] = handlerCall;

      expect(commandName).toBe("test-command");
      expect(handler).toBeInstanceOf(Function);

      // Test the handler
      const mockCtx = {
        message: {
          text: "/test-command arg1 arg2 arg3",
        },
      } as unknown as Context;

      await handler(mockCtx);

      expect(executeClaudeCommand).toHaveBeenCalledWith(
        mockCtx,
        "test-command",
        "arg1 arg2 arg3",
      );
    });

    it("should handle command with no arguments", async () => {
      const mockCommands = [
        {
          name: "test-command",
          filePath: "/test/commands/test-command.md",
          description: "A test command",
          content: "# Test Command",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      await registerDynamicCommands(mockBot);

      const handlerCall = vi.mocked(mockBot.command).mock.calls[0];
      const [, handler] = handlerCall;

      // Test handler with no arguments
      const mockCtx = {
        message: {
          text: "/test-command",
        },
      } as unknown as Context;

      await handler(mockCtx);

      expect(executeClaudeCommand).toHaveBeenCalledWith(
        mockCtx,
        "test-command",
        undefined,
      );
    });

    it("should handle command with only whitespace arguments", async () => {
      const mockCommands = [
        {
          name: "test-command",
          filePath: "/test/commands/test-command.md",
          description: "A test command",
          content: "# Test Command",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      await registerDynamicCommands(mockBot);

      const handlerCall = vi.mocked(mockBot.command).mock.calls[0];
      const [, handler] = handlerCall;

      // Test handler with whitespace-only arguments
      const mockCtx = {
        message: {
          text: "/test-command   \t  \n  ",
        },
      } as unknown as Context;

      await handler(mockCtx);

      expect(executeClaudeCommand).toHaveBeenCalledWith(
        mockCtx,
        "test-command",
        undefined,
      );
    });

    it("should handle missing message text", async () => {
      const mockCommands = [
        {
          name: "test-command",
          filePath: "/test/commands/test-command.md",
          description: "A test command",
          content: "# Test Command",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      await registerDynamicCommands(mockBot);

      const handlerCall = vi.mocked(mockBot.command).mock.calls[0];
      const [, handler] = handlerCall;

      // Test handler with missing message text
      const mockCtx = {
        message: {},
      } as unknown as Context;

      await handler(mockCtx);

      expect(executeClaudeCommand).toHaveBeenCalledWith(
        mockCtx,
        "test-command",
        undefined,
      );
    });
  });

  describe("getDynamicCommandsHelp", () => {
    it("should generate help text for discovered commands", async () => {
      const mockCommands = [
        {
          name: "test-command",
          filePath: "/test/commands/test-command.md",
          description: "A test command for testing",
          content: "# Test Command",
        },
        {
          name: "help-me",
          filePath: "/test/commands/help-me.md",
          description: "Gets help with tasks",
          content: "# Help Command",
        },
        {
          name: "no-description",
          filePath: "/test/commands/no-description.md",
          description: undefined,
          content: "# No Description",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      const help = await getDynamicCommandsHelp();

      const expectedHelp = `*Claude Commands:*
/test-command - A test command for testing
/help-me - Gets help with tasks
/no-description - No description available
`;

      expect(help).toBe(expectedHelp);
    });

    it("should return empty string when no commands found", async () => {
      vi.mocked(discoverClaudeCommands).mockResolvedValue([]);

      const help = await getDynamicCommandsHelp();

      expect(help).toBe("");
    });

    it("should handle commands with empty descriptions", async () => {
      const mockCommands = [
        {
          name: "empty-desc",
          filePath: "/test/commands/empty-desc.md",
          description: "",
          content: "# Empty Description",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      const help = await getDynamicCommandsHelp();

      expect(help).toBe(`*Claude Commands:*
/empty-desc - No description available
`);
    });

    it("should handle discovery errors gracefully", async () => {
      const error = new Error("Discovery failed");
      vi.mocked(discoverClaudeCommands).mockRejectedValue(error);

      const help = await getDynamicCommandsHelp();

      expect(help).toBe("");
      expect(getLogger().error).toHaveBeenCalledWith(
        { error },
        "Failed to get dynamic commands help",
      );
    });

    it("should handle commands with special characters in descriptions", async () => {
      const mockCommands = [
        {
          name: "special-chars",
          filePath: "/test/commands/special-chars.md",
          description: "Command with *markdown* and _special_ chars!",
          content: "# Special Chars",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      const help = await getDynamicCommandsHelp();

      expect(help).toBe(`*Claude Commands:*
/special-chars - Command with *markdown* and _special_ chars!
`);
    });

    it("should handle very long command descriptions", async () => {
      const longDescription =
        "This is a very long command description that exceeds normal length expectations and might cause formatting issues in some interfaces but should be handled gracefully";

      const mockCommands = [
        {
          name: "long-desc",
          filePath: "/test/commands/long-desc.md",
          description: longDescription,
          content: "# Long Description",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);

      const help = await getDynamicCommandsHelp();

      expect(help).toBe(`*Claude Commands:*
/long-desc - ${longDescription}
`);
    });
  });

  describe("Command Argument Parsing", () => {
    it("should correctly parse simple arguments", async () => {
      const mockCommands = [
        {
          name: "test-cmd",
          filePath: "/test/commands/test-cmd.md",
          description: "Test command",
          content: "# Test",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);
      await registerDynamicCommands(mockBot);

      const handlerCall = vi.mocked(mockBot.command).mock.calls[0];
      const [, handler] = handlerCall;

      const testCases = [
        { text: "/test-cmd hello world", expectedArgs: "hello world" },
        { text: "/test-cmd single", expectedArgs: "single" },
        { text: "/test-cmd", expectedArgs: undefined },
        { text: "/test-cmd   spaced   args   ", expectedArgs: "spaced   args" },
        {
          text: '/test-cmd "quoted argument"',
          expectedArgs: '"quoted argument"',
        },
        { text: "/test-cmd --flag value", expectedArgs: "--flag value" },
      ];

      for (const testCase of testCases) {
        vi.clearAllMocks();

        const mockCtx = {
          message: { text: testCase.text },
        } as unknown as Context;

        await handler(mockCtx);

        expect(executeClaudeCommand).toHaveBeenCalledWith(
          mockCtx,
          "test-cmd",
          testCase.expectedArgs,
        );
      }
    });

    it("should handle commands with hyphens and underscores", async () => {
      const mockCommands = [
        {
          name: "multi-word-command",
          filePath: "/test/commands/multi-word-command.md",
          description: "Multi word command",
          content: "# Multi Word",
        },
        {
          name: "snake_case_command",
          filePath: "/test/commands/snake_case_command.md",
          description: "Snake case command",
          content: "# Snake Case",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);
      await registerDynamicCommands(mockBot);

      expect(mockBot.command).toHaveBeenCalledWith(
        "multi-word-command",
        expect.any(Function),
      );
      expect(mockBot.command).toHaveBeenCalledWith(
        "snake_case_command",
        expect.any(Function),
      );
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle executeClaudeCommand failures gracefully", async () => {
      const mockCommands = [
        {
          name: "failing-command",
          filePath: "/test/commands/failing-command.md",
          description: "A command that fails",
          content: "# Failing Command",
        },
      ];

      vi.mocked(discoverClaudeCommands).mockResolvedValue(mockCommands);
      vi.mocked(executeClaudeCommand).mockRejectedValue(
        new Error("Execution failed"),
      );

      await registerDynamicCommands(mockBot);

      const handlerCall = vi.mocked(mockBot.command).mock.calls[0];
      const [, handler] = handlerCall;

      const mockCtx = {
        message: { text: "/failing-command test" },
      } as unknown as Context;

      // Should not throw error, should handle gracefully
      await expect(handler(mockCtx)).rejects.toThrow("Execution failed");
    });
  });
});
