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

// Claude API pricing (per 1M tokens) - Dec 2025
const MODEL_PRICING = {
  'claude-opus-4-5-20251101':   { input: 15.00, output: 75.00 },
  'claude-opus-4-6':            { input: 15.00, output: 75.00 },
  'claude-sonnet-4-5-20241022': { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-20250514':   { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20241022':  { input: 1.00,  output: 5.00 },
};

// Fallback pricing if model not recognized
const DEFAULT_PRICING = { input: 3.00, output: 15.00 };

function calculateCost(modelId, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[modelId] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

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
  MODEL_PRICING,
  DEFAULT_PRICING,
  calculateCost,
};
