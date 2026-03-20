const fs = require('fs');
const path = require('path');
const config = require('../config');

function getHookCommand(scriptName) {
  const scriptPath = path.resolve(__dirname, '..', scriptName).replace(/\\/g, '/');
  return `node "${scriptPath}"`;
}

function getStatuslineCommand() {
  const scriptPath = path.resolve(__dirname, '..', 'statusline.js').replace(/\\/g, '/');
  return `node "${scriptPath}"`;
}

function isClaudePresenceHook(entry) {
  if (!entry || !entry.hooks) return false;
  return entry.hooks.some((h) => h.command && h.command.includes('claude-presence'));
}

function createHookEntry(command) {
  return {
    hooks: [{ type: 'command', command }],
  };
}

function addHookToEvent(settings, eventName, command) {
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[eventName]) settings.hooks[eventName] = [];

  // Check if already installed (idempotent)
  const existing = settings.hooks[eventName].some(isClaudePresenceHook);
  if (existing) return false;

  settings.hooks[eventName].push(createHookEntry(command));
  return true;
}

function run() {
  console.log('Setting up claude-presence...\n');

  // Read current settings
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(config.SETTINGS_PATH, 'utf8'));
  } catch {
    console.log('No existing settings.json found, creating fresh config.');
  }

  // Save original statusline before we replace it
  const presenceConfig = config.getPresenceConfig();
  if (!presenceConfig.originalStatusline && settings.statusLine?.command) {
    presenceConfig.originalStatusline = settings.statusLine.command;
    presenceConfig.installedAt = new Date().toISOString();
    config.savePresenceConfig(presenceConfig);
    console.log('  Saved original statusline for chaining.');
  }

  // Add hooks
  let hooksAdded = 0;
  if (addHookToEvent(settings, 'SessionStart', getHookCommand('hooks/session-start.js'))) hooksAdded++;
  if (addHookToEvent(settings, 'PostToolUse', getHookCommand('hooks/post-tool-use.js'))) hooksAdded++;
  if (addHookToEvent(settings, 'Stop', getHookCommand('hooks/stop.js'))) hooksAdded++;
  if (addHookToEvent(settings, 'SessionEnd', getHookCommand('hooks/session-end.js'))) hooksAdded++;

  // Replace statusline
  const statuslineCmd = getStatuslineCommand();
  const statuslineChanged = settings.statusLine?.command !== statuslineCmd;
  if (statuslineChanged) {
    settings.statusLine = { type: 'command', command: statuslineCmd };
  }

  // Write settings back
  fs.writeFileSync(config.SETTINGS_PATH, JSON.stringify(settings, null, 2));

  console.log(`  ${hooksAdded} hook(s) added.`);
  if (statuslineChanged) {
    console.log('  Statusline updated (original will be chained).');
  }

  console.log('\nSetup complete!\n');

  // Check if Client ID is configured
  if (config.DISCORD_CLIENT_ID === 'YOUR_CLIENT_ID') {
    console.log('IMPORTANT: You need to set your Discord Application Client ID.');
    console.log('');
    console.log('  Option 1: Set environment variable:');
    console.log('    export CLAUDE_PRESENCE_CLIENT_ID="your-client-id"');
    console.log('');
    console.log('  Option 2: Create a Discord Application:');
    console.log('    1. Go to https://discord.com/developers/applications');
    console.log('    2. Click "New Application"');
    console.log('    3. Copy the Application ID');
    console.log('    4. Upload images under Rich Presence > Art Assets:');
    console.log('       - "claude-logo" (main image)');
    console.log('       - "status-coding" (small icon)');
    console.log('       - "status-thinking" (small icon)');
    console.log('       - "status-idle" (small icon)');
    console.log('');
  } else {
    console.log(`Discord Client ID: ${config.DISCORD_CLIENT_ID}`);
  }

  console.log('Discord presence will activate on your next Claude Code session.');
}

module.exports = { run };
