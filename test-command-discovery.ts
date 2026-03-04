#!/usr/bin/env tsx

import { join } from 'path';
import { discoverClaudeCommands } from './src/claude/commands.js';
import { initConfig, getWorkingDirectory } from './src/config.js';

// Set working directory to examples/basic for testing
const testDir = join(process.cwd(), 'examples', 'basic');
initConfig(testDir);

console.log('Testing command discovery...');
console.log('Working directory:', getWorkingDirectory());

try {
  const commands = await discoverClaudeCommands();
  console.log('\n✅ Command discovery successful!');
  console.log(`Found ${commands.length} commands:`);

  for (const command of commands) {
    console.log(`  - /${command.name}: ${command.description || 'No description'}`);
  }

  if (commands.length > 0) {
    console.log('\n✅ Manual Testing: Command discovery works correctly');
  } else {
    console.log('\n⚠️  Manual Testing: No commands found (expected at least test-command)');
  }
} catch (error) {
  console.error('\n❌ Command discovery failed:', error.message);
  process.exit(1);
}