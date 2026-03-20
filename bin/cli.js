#!/usr/bin/env node

const command = process.argv[2];

function printHelp() {
  console.log(`
claude-presence - Discord Rich Presence for Claude Code CLI

Usage:
  claude-presence <command>

Commands:
  setup       Install hooks into Claude Code settings
  uninstall   Remove hooks and restore original settings
  status      Show current presence status

Options:
  --help, -h  Show this help message
  --version   Show version

Examples:
  claude-presence setup       # Install (run once)
  claude-presence uninstall   # Remove completely
  claude-presence status      # Check if it's working
`);
}

function showStatus() {
  const fs = require('fs');
  const config = require('../src/config');

  console.log('claude-presence status\n');

  // Check settings.json for hooks
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(config.SETTINGS_PATH, 'utf8'));
  } catch {}

  const hookEvents = ['SessionStart', 'PostToolUse', 'Stop', 'SessionEnd'];
  let installedHooks = 0;
  for (const event of hookEvents) {
    const hooks = settings.hooks?.[event] || [];
    const hasPresence = hooks.some((e) => e.hooks?.some((h) => h.command?.includes('claude-presence')));
    console.log(`  ${event}: ${hasPresence ? 'installed' : 'not installed'}`);
    if (hasPresence) installedHooks++;
  }

  const statuslineInstalled = settings.statusLine?.command?.includes('claude-presence');
  console.log(`  StatusLine: ${statuslineInstalled ? 'installed' : 'not installed'}`);

  console.log(`\n  Hooks installed: ${installedHooks}/4`);

  // Check Client ID
  console.log(`\n  Client ID: ${config.DISCORD_CLIENT_ID === 'YOUR_CLIENT_ID' ? 'NOT SET' : config.DISCORD_CLIENT_ID}`);

  // Check for active sessions
  try {
    const files = fs.readdirSync(config.BRIDGE_DIR);
    const sessions = files.filter((f) => f.startsWith('session-') && f.endsWith('.json'));
    const daemons = files.filter((f) => f.startsWith('daemon-') && f.endsWith('.pid'));

    console.log(`\n  Active sessions: ${sessions.length}`);
    console.log(`  Running daemons: ${daemons.length}`);

    let totalTokensIn = 0, totalTokensOut = 0, totalCost = 0;

    for (const sessionFile of sessions) {
      try {
        const data = JSON.parse(fs.readFileSync(require('path').join(config.BRIDGE_DIR, sessionFile), 'utf8'));
        const project = data.workspace?.project || 'unknown';
        const status = data.activity?.status || 'unknown';
        const model = data.model || 'unknown';
        console.log(`\n  Session: ${project} | ${model} | ${status}`);
        if (data.tokens) {
          console.log(`    Tokens: ${data.tokens.in} in / ${data.tokens.out} out`);
          totalTokensIn += data.tokens.in || 0;
          totalTokensOut += data.tokens.out || 0;
        }
        if (data.cost_usd != null) {
          console.log(`    Cost: $${data.cost_usd.toFixed(4)}`);
          totalCost += data.cost_usd;
        }
      } catch {}
    }

    if (sessions.length > 1) {
      console.log(`\n  --- Totals across ${sessions.length} sessions ---`);
      console.log(`  Tokens: ${totalTokensIn} in / ${totalTokensOut} out (${totalTokensIn + totalTokensOut} total)`);
      console.log(`  Cost: $${totalCost.toFixed(4)}`);
    }
  } catch {
    console.log('\n  No active sessions.');
  }

  // Check original statusline
  const originalCmd = config.getOriginalStatusline();
  if (originalCmd) {
    console.log(`\n  Original statusline saved: yes`);
  }
}

switch (command) {
  case 'setup':
    require('../src/cli/setup').run();
    break;
  case 'uninstall':
    require('../src/cli/uninstall').run();
    break;
  case 'status':
    showStatus();
    break;
  case '--version':
    console.log(require('../package.json').version);
    break;
  case '--help':
  case '-h':
  case undefined:
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
