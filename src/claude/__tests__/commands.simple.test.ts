import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkingDirectory } from "../../config.js";
import { getLogger } from "../../logger.js";
import { clearCommandCache } from "../commands.js";

// Mock dependencies
vi.mock("../../config.js");
vi.mock("../../logger.js");

// Mock fs operations with factory function
vi.mock("node:fs/promises", () => {
  const mockReaddir = vi.fn();
  const mockReadFile = vi.fn();

  // Export the mocks to be accessible in tests
  (global as any).__mockReaddir = mockReaddir;
  (global as any).__mockReadFile = mockReadFile;

  return {
    readdir: mockReaddir,
    readFile: mockReadFile,
  };
});

// Get references to the mocks
const mockReaddir = (global as any).__mockReaddir;
const mockReadFile = (global as any).__mockReadFile;

describe("Claude Commands - Core Functionality", () => {
  const testWorkingDir = "/test/working";
  const testCommandsDir = join(testWorkingDir, ".claude", "commands");

  beforeEach(() => {
    vi.clearAllMocks();

    // Clear command cache to ensure fresh state for each test
    clearCommandCache();

    // Mock working directory
    vi.mocked(getWorkingDirectory).mockReturnValue(testWorkingDir);

    // Mock logger
    vi.mocked(getLogger).mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Command Discovery", () => {
    it("should discover commands with valid frontmatter", async () => {
      // Import after mocks are set up
      const { discoverClaudeCommands } = await import("../commands.js");

      // Setup mock data
      mockReaddir.mockResolvedValue([
        "test-command.md",
        "another-command.md",
        "not-markdown.txt",
      ]);

      mockReadFile
        .mockResolvedValueOnce(`---
description: Test command for testing
---

# Test Command
This is a test command.`)
        .mockResolvedValueOnce(`---
description: Another test command
---

# Another Command
This is another test command.`);

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual({
        name: "test-command",
        filePath: join(testCommandsDir, "test-command.md"),
        description: "Test command for testing",
        content: expect.stringContaining("# Test Command"),
      });
      expect(commands[1]).toEqual({
        name: "another-command",
        filePath: join(testCommandsDir, "another-command.md"),
        description: "Another test command",
        content: expect.stringContaining("# Another Command"),
      });
    });

    it("should handle commands without frontmatter", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["simple-command.md"]);
      mockReadFile.mockResolvedValue(
        "# Simple Command\nThis command has no frontmatter.",
      );

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({
        name: "simple-command",
        filePath: join(testCommandsDir, "simple-command.md"),
        description: undefined,
        content: "# Simple Command\nThis command has no frontmatter.",
      });
    });

    it("should ignore non-markdown files", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue([
        "command.md",
        "readme.txt",
        "config.json",
        "script.sh",
        "another-command.md",
      ]);

      mockReadFile
        .mockResolvedValueOnce("# Command 1")
        .mockResolvedValueOnce("# Command 2");

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(2);
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });

    it("should handle directory not found gracefully", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockRejectedValue(
        new Error("ENOENT: no such file or directory"),
      );

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(0);
      expect(getLogger().debug).toHaveBeenCalledWith(
        expect.objectContaining({ commandsDir: testCommandsDir }),
        "No Claude commands directory found",
      );
    });

    it("should handle individual file read errors", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue([
        "working.md",
        "broken.md",
        "also-working.md",
      ]);

      mockReadFile
        .mockResolvedValueOnce("# Working Command 1")
        .mockRejectedValueOnce(new Error("Permission denied"))
        .mockResolvedValueOnce("# Working Command 2");

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(2);
      expect(commands[0].name).toBe("working");
      expect(commands[1].name).toBe("also-working");

      expect(getLogger().warn).toHaveBeenCalledWith(
        expect.objectContaining({ file: "broken.md" }),
        "Failed to read Claude command file",
      );
    });

    it("should handle empty command files", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["empty.md"]);
      mockReadFile.mockResolvedValue("");

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({
        name: "empty",
        filePath: join(testCommandsDir, "empty.md"),
        description: undefined,
        content: "",
      });
    });
  });

  describe("Frontmatter Parsing", () => {
    it("should parse simple description field", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["test.md"]);
      mockReadFile.mockResolvedValue(`---
description: Simple description
---
Content`);

      const commands = await discoverClaudeCommands();
      expect(commands[0].description).toBe("Simple description");
    });

    it("should handle quoted descriptions", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["test.md"]);
      mockReadFile.mockResolvedValue(`---
description: "Quoted description with special chars: !@#$%"
---
Content`);

      const commands = await discoverClaudeCommands();
      expect(commands[0].description).toBe(
        'Quoted description with special chars: !@#$%',
      );
    });

    it("should ignore non-description frontmatter fields", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["test.md"]);
      mockReadFile.mockResolvedValue(`---
title: Test Command
author: Developer
description: Only this matters
version: 1.0.0
---
Content`);

      const commands = await discoverClaudeCommands();
      expect(commands[0].description).toBe("Only this matters");
    });

    it("should handle missing description field", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["test.md"]);
      mockReadFile.mockResolvedValue(`---
title: Test Command
author: Developer
---
Content`);

      const commands = await discoverClaudeCommands();
      expect(commands[0].description).toBeUndefined();
    });
  });

  describe("getClaudeCommand Function", () => {
    it("should return specific command by name", async () => {
      const { getClaudeCommand } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["first.md", "second.md", "third.md"]);

      mockReadFile
        .mockResolvedValueOnce("# First Command")
        .mockResolvedValueOnce(`---
description: This is the second command
---
# Second Command`)
        .mockResolvedValueOnce("# Third Command");

      const command = await getClaudeCommand("second");

      expect(command).toEqual({
        name: "second",
        filePath: join(testCommandsDir, "second.md"),
        description: "This is the second command",
        content: expect.stringContaining("# Second Command"),
      });
    });

    it("should return null for non-existent command", async () => {
      const { getClaudeCommand } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["first.md", "second.md"]);
      mockReadFile
        .mockResolvedValueOnce("# First Command")
        .mockResolvedValueOnce("# Second Command");

      const command = await getClaudeCommand("nonexistent");

      expect(command).toBeNull();
    });

    it("should handle empty commands directory", async () => {
      const { getClaudeCommand } = await import("../commands.js");

      mockReaddir.mockResolvedValue([]);

      const command = await getClaudeCommand("any-command");

      expect(command).toBeNull();
    });
  });

  describe("Performance and Validation Tests", () => {
    it("should handle special characters in command names", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue([
        "special-chars_123.md",
        "dots.in.name.md",
        "numbers-123.md",
      ]);

      mockReadFile
        .mockResolvedValue("# Command 1")
        .mockResolvedValue("# Command 2")
        .mockResolvedValue("# Command 3");

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(3);
      expect(commands[0].name).toBe("special-chars_123");
      expect(commands[1].name).toBe("dots.in.name");
      expect(commands[2].name).toBe("numbers-123");
    });

    it("should handle very long command names", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      const longName =
        "very-long-command-name-that-exceeds-normal-length-expectations-and-might-cause-issues";
      mockReaddir.mockResolvedValue([`${longName}.md`]);
      mockReadFile.mockResolvedValue("# Long Command");

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(1);
      expect(commands[0].name).toBe(longName);
    });

    it("should detect potential command conflicts", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      // Test for commands that might conflict with built-in commands
      const conflictingNames = ["start", "help", "stop", "clear", "settings"];

      mockReaddir.mockResolvedValue(
        conflictingNames.map((name) => `${name}.md`),
      );

      // Mock file reads for each command
      for (let i = 0; i < conflictingNames.length; i++) {
        mockReadFile.mockResolvedValueOnce(`# ${conflictingNames[i]} command`);
      }

      const commands = await discoverClaudeCommands();

      // Only non-reserved commands should be discovered
      // Reserved: ["start", "help", "clear", "dynamic"]
      // From conflictingNames: ["start", "help", "stop", "clear", "settings"]
      // Expected to pass: ["stop", "settings"] = 2 commands
      expect(commands).toHaveLength(2);

      // Verify that reserved commands were filtered out and non-reserved ones were kept
      const discoveredNames = commands.map((cmd) => cmd.name);
      expect(discoveredNames).toEqual(
        expect.arrayContaining(["stop", "settings"]),
      );

      // Verify reserved commands were not included
      expect(discoveredNames).not.toContain("start");
      expect(discoveredNames).not.toContain("help");
      expect(discoveredNames).not.toContain("clear");
    });

    it("should handle malformed frontmatter without crashing", async () => {
      const { discoverClaudeCommands } = await import("../commands.js");

      mockReaddir.mockResolvedValue(["malformed.md"]);
      mockReadFile.mockResolvedValue(`---
invalid yaml syntax {[
no proper structure
description without colon
---
# Malformed Command`);

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(1);
      expect(commands[0].description).toBeUndefined();
      expect(commands[0].content).toContain("# Malformed Command");
    });
  });
});
