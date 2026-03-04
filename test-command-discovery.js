#!/usr/bin/env node

import { join } from 'path';
import { discoverClaudeCommands } from './dist/claude/commands.js';

// Set working directory to examples/basic for testing
const testDir = join(process.cwd(), 'examples', 'basic');
process.chdir(testDir);

console.log('Testing command discovery...');
console.log('Working directory:', process.cwd());

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