const fs = require('fs');
const path = require('path');
const config = require('../config');

function isClaudePresenceHook(entry) {
  if (!entry || !entry.hooks) return false;
  return entry.hooks.some((h) => h.command && h.command.includes('claude-presence'));
}

function run() {
  console.log('Uninstalling claude-presence...\n');

  // Read current settings
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(config.SETTINGS_PATH, 'utf8'));
  } catch {
    console.log('No settings.json found. Nothing to uninstall.');
    return;
  }

  // Remove claude-presence hooks from all events
  let hooksRemoved = 0;
  if (settings.hooks) {
    for (const eventName of Object.keys(settings.hooks)) {
      const before = settings.hooks[eventName].length;
      settings.hooks[eventName] = settings.hooks[eventName].filter((entry) => !isClaudePresenceHook(entry));
      hooksRemoved += before - settings.hooks[eventName].length;

      // Clean up empty arrays
      if (settings.hooks[eventName].length === 0) {
        delete settings.hooks[eventName];
      }
    }
  }

  // Restore original statusline
  const presenceConfig = config.getPresenceConfig();
  if (presenceConfig.originalStatusline) {
    settings.statusLine = { type: 'command', command: presenceConfig.originalStatusline };
    console.log('  Restored original statusline.');
  } else if (settings.statusLine?.command?.includes('claude-presence')) {
    delete settings.statusLine;
    console.log('  Removed statusline (no original to restore).');
  }

  // Write settings back
  fs.writeFileSync(config.SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log(`  ${hooksRemoved} hook(s) removed.`);

  // Kill running daemons
  try {
    const files = fs.readdirSync(config.BRIDGE_DIR);
    let killed = 0;
    for (const file of files) {
      if (file.startsWith('daemon-') && file.endsWith('.pid')) {
        try {
          const pid = parseInt(fs.readFileSync(path.join(config.BRIDGE_DIR, file), 'utf8').trim(), 10);
          process.kill(pid, 'SIGTERM');
          killed++;
        } catch {}
      }
    }
    if (killed > 0) console.log(`  Stopped ${killed} running daemon(s).`);
  } catch {}

  // Clean up bridge directory
  try {
    const files = fs.readdirSync(config.BRIDGE_DIR);
    for (const file of files) {
      try { fs.unlinkSync(path.join(config.BRIDGE_DIR, file)); } catch {}
    }
    fs.rmdirSync(config.BRIDGE_DIR);
    console.log('  Cleaned up bridge files.');
  } catch {}

  // Remove presence config
  try {
    fs.unlinkSync(config.PRESENCE_CONFIG_PATH);
    console.log('  Removed presence config.');
  } catch {}

  console.log('\nUninstall complete. Discord presence will no longer show for Claude Code sessions.');
}

module.exports = { run };
