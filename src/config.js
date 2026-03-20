const path = require('path');
const os = require('os');
const fs = require('fs');

const DISCORD_CLIENT_ID = process.env.CLAUDE_PRESENCE_CLIENT_ID || '1484378196735426561';

const BRIDGE_DIR = path.join(os.tmpdir(), 'claude-presence');

const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS_PATH = path.join(CLAUDE_CONFIG_DIR, 'settings.json');
const PRESENCE_CONFIG_PATH = path.join(CLAUDE_CONFIG_DIR, 'claude-presence.json');

const IMAGE_KEYS = {
  large: 'claude-logo',
  coding: 'status-coding',
  thinking: 'status-thinking',
  idle: 'status-idle',
};

const IDLE_TIMEOUT_MS = 120_000;
const RECONNECT_INTERVAL_MS = 15_000;
const ORPHAN_TIMEOUT_MS = 600_000;
const WATCH_INTERVAL_MS = 1500;
const STDIN_TIMEOUT_MS = 3000;

function bridgePath(sessionId) {
  return path.join(BRIDGE_DIR, `session-${sessionId}.json`);
}

function pidPath(sessionId) {
  return path.join(BRIDGE_DIR, `daemon-${sessionId}.pid`);
}

function getPresenceConfig() {
  try {
    return JSON.parse(fs.readFileSync(PRESENCE_CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function savePresenceConfig(config) {
  fs.writeFileSync(PRESENCE_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getOriginalStatusline() {
  const config = getPresenceConfig();
  return config.originalStatusline || null;
}

module.exports = {
  DISCORD_CLIENT_ID,
  BRIDGE_DIR,
  CLAUDE_CONFIG_DIR,
  SETTINGS_PATH,
  PRESENCE_CONFIG_PATH,
  IMAGE_KEYS,
  IDLE_TIMEOUT_MS,
  RECONNECT_INTERVAL_MS,
  ORPHAN_TIMEOUT_MS,
  WATCH_INTERVAL_MS,
  STDIN_TIMEOUT_MS,
  bridgePath,
  pidPath,
  getPresenceConfig,
  savePresenceConfig,
  getOriginalStatusline,
};
