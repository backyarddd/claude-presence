const fs = require('fs');
const path = require('path');
const config = require('../config');

const HOOK_SCRIPTS = {
  SessionStart: 'hooks/session-start.js',
  PostToolUse: 'hooks/post-tool-use.js',
  Stop: 'hooks/stop.js',
  SessionEnd: 'hooks/session-end.js',
};

function getHookCommand(scriptName) {
  const scriptPath = path.resolve(__dirname, '..', scriptName).replace(/\\/g, '/');
  return `node "${scriptPath}"`;
}

function getStatuslineCommand() {
  const scriptPath = path.resolve(__dirname, '..', 'statusline.js').replace(/\\/g, '/');
  return `node "${scriptPath}"`;
}

function createHookEntry(command) {
  return {
    hooks: [{ type: 'command', command }],
  };
}

// Pulls every claude-presence hook out of an event, leaving the user's own hooks - and
// their entries' matchers - untouched. Returns the commands that were removed.
function extractOwnHooks(entries) {
  const removed = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || !Array.isArray(entry.hooks)) continue;

    const kept = [];
    for (const hook of entry.hooks) {
      if (hook && config.isOwnedCommand(hook.command)) {
        removed.push(hook.command);
      } else {
        kept.push(hook);
      }
    }

    if (kept.length === entry.hooks.length) continue;
    if (kept.length === 0) {
      entries.splice(i, 1);
    } else {
      entry.hooks = kept;
    }
  }

  return removed;
}

// Hook commands embed the absolute path of the installed package, so an existing entry
// can point at a location that no longer exists (reinstall, npm prefix change, Node
// version switch). Repoint instead of skipping. Returns 'added', 'updated' or 'unchanged'.
function setHookForEvent(settings, eventName, command) {
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks[eventName])) settings.hooks[eventName] = [];

  const entries = settings.hooks[eventName];

  // Already correct: one entry, ours alone in it, no matcher narrowing it. Leave it in place.
  const alreadyInstalled = entries.some(
    (entry) =>
      entry
      && !entry.matcher
      && Array.isArray(entry.hooks)
      && entry.hooks.length === 1
      && entry.hooks[0]
      && entry.hooks[0].command === command
  );
  const ownCommands = entries
    .filter((entry) => entry && Array.isArray(entry.hooks))
    .flatMap((entry) => entry.hooks.filter((hook) => hook && config.isOwnedCommand(hook.command)));

  if (alreadyInstalled && ownCommands.length === 1) return 'unchanged';

  const removed = extractOwnHooks(entries);
  entries.push(createHookEntry(command));

  return removed.length === 0 ? 'added' : 'updated';
}

function writeSettings(settings) {
  const tmpPath = config.SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
  fs.renameSync(tmpPath, config.SETTINGS_PATH);
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

  const statuslineCmd = getStatuslineCommand();

  // Remember whatever statusline is in place so uninstall can restore it, and so our
  // wrapper can chain to it. Never remember one of ours - that would chain to itself.
  const presenceConfig = config.getPresenceConfig();
  const currentStatusline = settings.statusLine?.command;
  let presenceConfigChanged = false;

  if (presenceConfig.originalStatusline && config.isOwnedCommand(presenceConfig.originalStatusline)) {
    delete presenceConfig.originalStatusline;
    presenceConfigChanged = true;
  }

  if (currentStatusline && !config.isOwnedCommand(currentStatusline)
      && presenceConfig.originalStatusline !== currentStatusline) {
    presenceConfig.originalStatusline = currentStatusline;
    presenceConfig.installedAt = new Date().toISOString();
    presenceConfigChanged = true;
    console.log('  Saved original statusline for chaining.');
  }

  if (presenceConfigChanged) config.savePresenceConfig(presenceConfig);

  // Add or repoint hooks
  let hooksAdded = 0;
  let hooksUpdated = 0;
  for (const [eventName, script] of Object.entries(HOOK_SCRIPTS)) {
    const result = setHookForEvent(settings, eventName, getHookCommand(script));
    if (result === 'added') hooksAdded++;
    if (result === 'updated') hooksUpdated++;
  }

  // Replace statusline
  const statuslineChanged = settings.statusLine?.command !== statuslineCmd;
  if (statuslineChanged) {
    settings.statusLine = { type: 'command', command: statuslineCmd };
  }

  writeSettings(settings);

  if (hooksAdded > 0) console.log(`  ${hooksAdded} hook(s) added.`);
  if (hooksUpdated > 0) console.log(`  ${hooksUpdated} hook(s) repointed to this install.`);
  if (hooksAdded === 0 && hooksUpdated === 0) console.log('  Hooks already up to date.');
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

module.exports = { run, setHookForEvent, extractOwnHooks, getHookCommand, getStatuslineCommand };
