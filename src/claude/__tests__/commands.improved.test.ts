import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { getWorkingDirectory } from '../../config.js';
import { getLogger } from '../../logger.js';

// Mock dependencies
vi.mock('../../config.js');
vi.mock('../../logger.js');

// Mock fs operations at the top level
const mockReaddir = vi.fn();
const mockReadFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

describe('Improved Claude Commands - Performance and Validation', () => {
  const testWorkingDir = '/test/working';
  const testCommandsDir = join(testWorkingDir, '.claude', 'commands');

  beforeEach(() => {
    vi.clearAllMocks();

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

  describe('Command Validation', () => {
    it('should reject commands that conflict with built-ins', async () => {
      // Import after mocks are set up
      const { discoverClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache(); // Clear cache before test

      // Setup mock data with conflicting command names
      mockReaddir.mockResolvedValue(['start.md', 'help.md', 'valid-command.md']);

      mockReadFile
        .mockResolvedValueOnce(`---
description: This conflicts with built-in start command
---
# Start Command`)
        .mockResolvedValueOnce(`---
description: This conflicts with built-in help command
---
# Help Command`)
        .mockResolvedValueOnce(`---
description: This is a valid command
---
# Valid Command`);

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(3);

      // Check that built-in conflicts are marked as invalid
      const startCommand = commands.find(cmd => cmd.name === 'start');
      const helpCommand = commands.find(cmd => cmd.name === 'help');
      const validCommand = commands.find(cmd => cmd.name === 'valid-command');

      expect(startCommand?.isValid).toBe(false);
      expect(startCommand?.validationError).toContain('conflicts with built-in command');

      expect(helpCommand?.isValid).toBe(false);
      expect(helpCommand?.validationError).toContain('conflicts with built-in command');

      expect(validCommand?.isValid).toBe(true);
      expect(validCommand?.validationError).toBeUndefined();
    });

    it('should reject commands with invalid characters', async () => {
      const { discoverClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue([
        'valid-command_123.md',
        'invalid@command.md',
        'another#invalid.md',
        'valid.dots.command.md'
      ]);

      mockReadFile
        .mockResolvedValue('# Test Command')
        .mockResolvedValue('# Test Command')
        .mockResolvedValue('# Test Command')
        .mockResolvedValue('# Test Command');

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(4);

      const validCommand1 = commands.find(cmd => cmd.name === 'valid-command_123');
      const invalidCommand1 = commands.find(cmd => cmd.name === 'invalid@command');
      const invalidCommand2 = commands.find(cmd => cmd.name === 'another#invalid');
      const validCommand2 = commands.find(cmd => cmd.name === 'valid.dots.command');

      expect(validCommand1?.isValid).toBe(true);
      expect(invalidCommand1?.isValid).toBe(false);
      expect(invalidCommand1?.validationError).toContain('invalid characters');
      expect(invalidCommand2?.isValid).toBe(false);
      expect(invalidCommand2?.validationError).toContain('invalid characters');
      expect(validCommand2?.isValid).toBe(true);
    });

    it('should reject commands with invalid length or format', async () => {
      const { discoverClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      const longCommandName = 'a'.repeat(70); // Too long
      mockReaddir.mockResolvedValue([
        '.invalid-start.md',
        'invalid-end-.md',
        `${longCommandName}.md`,
        'valid-command.md'
      ]);

      mockReadFile
        .mockResolvedValue('# Test Command')
        .mockResolvedValue('# Test Command')
        .mockResolvedValue('# Test Command')
        .mockResolvedValue('# Test Command');

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(4);

      const invalidStart = commands.find(cmd => cmd.name === '.invalid-start');
      const invalidEnd = commands.find(cmd => cmd.name === 'invalid-end-');
      const tooLong = commands.find(cmd => cmd.name === longCommandName);
      const valid = commands.find(cmd => cmd.name === 'valid-command');

      expect(invalidStart?.isValid).toBe(false);
      expect(invalidStart?.validationError).toContain('cannot start or end');

      expect(invalidEnd?.isValid).toBe(false);
      expect(invalidEnd?.validationError).toContain('cannot start or end');

      expect(tooLong?.isValid).toBe(false);
      expect(tooLong?.validationError).toContain('too long');

      expect(valid?.isValid).toBe(true);
    });

    it('should sanitize command descriptions', async () => {
      const { discoverClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['sanitize-test.md']);
      mockReadFile.mockResolvedValue(`---
description: "Command with <script>alert('xss')</script> and control chars \x00\x08"
---
# Sanitize Test`);

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(1);
      expect(commands[0].description).not.toContain('<script>');
      expect(commands[0].description).not.toContain('\x00');
      expect(commands[0].description).not.toContain('\x08');
      // Should have removed < and > characters and control chars
      expect(commands[0].description).toContain("alert('xss')");
      expect(commands[0].description).not.toContain('<');
      expect(commands[0].description).not.toContain('>');
    });

    it('should handle malformed frontmatter gracefully', async () => {
      const { discoverClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['malformed.md']);
      mockReadFile.mockResolvedValue(`---
invalid: yaml: syntax: {[}]
description without colon
malformed structure
---
# Malformed Command`);

      const commands = await discoverClaudeCommands();

      expect(commands).toHaveLength(1);
      expect(commands[0].description).toBeUndefined();
      expect(commands[0].isValid).toBe(true); // Still valid command name

      // Note: The simple parser doesn't actually throw errors for malformed frontmatter,
      // it just silently ignores fields it can't parse. This is by design for robustness.
    });
  });

  describe('Caching Functionality', () => {
    it('should cache discovered commands', async () => {
      const { discoverClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['cached-command.md']);
      mockReadFile.mockResolvedValue('# Cached Command');

      // First call should read from filesystem
      const commands1 = await discoverClaudeCommands();
      expect(mockReaddir).toHaveBeenCalledTimes(1);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const commands2 = await discoverClaudeCommands();
      expect(mockReaddir).toHaveBeenCalledTimes(1); // No additional calls
      expect(mockReadFile).toHaveBeenCalledTimes(1); // No additional calls

      expect(commands1).toEqual(commands2);
      expect(getLogger().debug).toHaveBeenCalledWith(
        expect.objectContaining({ cached: true }),
        'Using cached Claude commands'
      );
    });

    it('should clear cache when requested', async () => {
      const { discoverClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['test-command.md']);
      mockReadFile.mockResolvedValue('# Test Command');

      // First discovery
      await discoverClaudeCommands();
      expect(mockReaddir).toHaveBeenCalledTimes(1);

      // Clear cache
      clearCommandsCache();

      // Second discovery should re-read filesystem
      await discoverClaudeCommands();
      expect(mockReaddir).toHaveBeenCalledTimes(2);
    });

    it('should cache empty results when no commands directory exists', async () => {
      const { discoverClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      // First call should attempt to read directory
      const commands1 = await discoverClaudeCommands();
      expect(commands1).toHaveLength(0);
      expect(mockReaddir).toHaveBeenCalledTimes(1);

      // Second call should use cached empty result
      const commands2 = await discoverClaudeCommands();
      expect(commands2).toHaveLength(0);
      expect(mockReaddir).toHaveBeenCalledTimes(1); // No additional filesystem call
    });
  });

  describe('Filtered Command Access', () => {
    it('should return only valid commands', async () => {
      const { getValidClaudeCommands, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['valid.md', 'start.md', 'another-valid.md']);
      mockReadFile
        .mockResolvedValueOnce('# Valid Command')
        .mockResolvedValueOnce('# Start Command (conflicts)')
        .mockResolvedValueOnce('# Another Valid Command');

      const validCommands = await getValidClaudeCommands();

      expect(validCommands).toHaveLength(2);
      expect(validCommands.map(cmd => cmd.name)).toEqual(['valid', 'another-valid']);
      expect(validCommands.every(cmd => cmd.isValid)).toBe(true);
    });

    it('should get specific valid command by name', async () => {
      const { getValidClaudeCommand, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['valid.md', 'start.md']);
      mockReadFile
        .mockResolvedValueOnce('# Valid Command')
        .mockResolvedValueOnce('# Start Command');

      const validCommand = await getValidClaudeCommand('valid');
      const invalidCommand = await getValidClaudeCommand('start');

      expect(validCommand?.name).toBe('valid');
      expect(validCommand?.isValid).toBe(true);
      expect(invalidCommand).toBeNull(); // Invalid command should return null
    });

    it('should get validation errors for debugging', async () => {
      const { getCommandValidationErrors, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['start.md', 'help.md', 'invalid@name.md']);
      mockReadFile
        .mockResolvedValue('# Command')
        .mockResolvedValue('# Command')
        .mockResolvedValue('# Command');

      const errors = await getCommandValidationErrors();

      expect(errors).toHaveLength(3);
      expect(errors.map(e => e.name)).toEqual(expect.arrayContaining(['start', 'help', 'invalid@name']));
      expect(errors.every(e => e.error)).toBeTruthy();
    });
  });

  describe('Integration with Existing getClaudeCommand', () => {
    it('should maintain backward compatibility with getClaudeCommand', async () => {
      const { getClaudeCommand, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['test.md', 'start.md']);
      mockReadFile
        .mockResolvedValueOnce('# Test Command')
        .mockResolvedValueOnce('# Start Command');

      const validCommand = await getClaudeCommand('test');
      const invalidCommand = await getClaudeCommand('start');

      // Should return command objects regardless of validity
      expect(validCommand?.name).toBe('test');
      expect(validCommand?.isValid).toBe(true);

      expect(invalidCommand?.name).toBe('start');
      expect(invalidCommand?.isValid).toBe(false);
    });

    it('should return null for non-existent commands', async () => {
      const { getClaudeCommand, clearCommandsCache } = await import('../commands.improved.js');

      clearCommandsCache();

      mockReaddir.mockResolvedValue(['existing.md']);
      mockReadFile.mockResolvedValue('# Existing Command');

      const nonExistent = await getClaudeCommand('non-existent');

      expect(nonExistent).toBeNull();
    });
  });
});