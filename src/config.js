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

// Claude API list pricing, USD per 1M tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-09-01)
// The 1M-token context window is billed at these standard rates - there is no
// long-context premium. Cache writes (1.25x/2x) and cache reads (0.1x, 0.025x on
// Fable/Mythos 5.1) are not modelled: Claude Code's statusline reports only total
// input and output tokens, so a calculated cost is an upper bound.
const MODEL_PRICING = {
  'claude-fable-5-1':          { input: 10.00, output: 50.00 },
  'claude-mythos-5-1':         { input: 10.00, output: 50.00 },
  'claude-fable-5':            { input: 10.00, output: 50.00 },
  'claude-mythos-5':           { input: 10.00, output: 50.00 },
  'claude-opus-5':             { input:  5.00, output: 25.00 },
  'claude-opus-4-8':           { input:  5.00, output: 25.00 },
  'claude-opus-4-7':           { input:  5.00, output: 25.00 },
  'claude-opus-4-6':           { input:  5.00, output: 25.00 },
  'claude-opus-4-5':           { input:  5.00, output: 25.00 },
  'claude-opus-4-1':           { input: 15.00, output: 75.00 },
  'claude-opus-4-0':           { input: 15.00, output: 75.00 },
  'claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'claude-sonnet-5':           { input:  2.00, output: 10.00 },
  'claude-sonnet-4-6':         { input:  3.00, output: 15.00 },
  'claude-sonnet-4-5':         { input:  3.00, output: 15.00 },
  'claude-sonnet-4-0':         { input:  3.00, output: 15.00 },
  'claude-sonnet-4-20250514':  { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':          { input:  1.00, output:  5.00 },
};

// Unknown ids are most often a model newer than this table; Claude Code defaults to
// the Opus tier, so price them there rather than silently under-reporting.
const DEFAULT_PRICING = { input: 5.00, output: 25.00 };

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Claude Code appends a context-tier suffix to the model id ("claude-opus-5[1m]").
function normalizeModelId(modelId) {
  if (typeof modelId !== 'string') return '';
  return modelId.trim().toLowerCase().replace(/\[[^\]]*\]/g, '');
}

// Matches exact ids first, then the longest known alias contained in the id, so dated
// snapshots ("claude-haiku-4-5-20251001") and platform prefixes ("anthropic.claude-opus-5")
// still resolve.
function resolvePricing(modelId) {
  const id = normalizeModelId(modelId);
  if (!id) return DEFAULT_PRICING;

  if (MODEL_PRICING[id]) return MODEL_PRICING[id];

  let bestAlias = null;
  for (const alias of Object.keys(MODEL_PRICING)) {
    // A trailing digit means a different model ("claude-opus-4-10" is not "claude-opus-4-1");
    // a trailing dash is a dated snapshot and still resolves.
    if (!new RegExp(escapeRegExp(alias) + '(?![0-9])').test(id)) continue;
    if (!bestAlias || alias.length > bestAlias.length) bestAlias = alias;
  }
  return bestAlias ? MODEL_PRICING[bestAlias] : DEFAULT_PRICING;
}

function calculateCost(modelId, inputTokens, outputTokens) {
  const pricing = resolvePricing(modelId);
  const inputCost = ((inputTokens || 0) / 1_000_000) * pricing.input;
  const outputCost = ((outputTokens || 0) / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

const PACKAGE_ROOT = path.resolve(__dirname, '..');

// Scripts this package installs into settings.json.
const OWNED_SCRIPTS = [
  'session-start.js',
  'post-tool-use.js',
  'stop.js',
  'session-end.js',
  'statusline.js',
];

function toPosixLower(value) {
  return String(value).replace(/\\/g, '/').toLowerCase();
}

// True for a hook or statusline command this package installed - either this install or
// an earlier one at a different path. Deliberately narrow: a user hook that merely
// mentions claude-presence (their own claude-presence-extras/mylog.js) is not ours to
// rewrite or remove.
function isOwnedCommand(command) {
  if (typeof command !== 'string') return false;
  const normalized = toPosixLower(command);
  if (normalized.includes(toPosixLower(PACKAGE_ROOT))) return true;
  if (!normalized.includes('claude-presence')) return false;
  return OWNED_SCRIPTS.some((script) => normalized.includes('/' + script));
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
  PACKAGE_ROOT,
  isOwnedCommand,
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
  normalizeModelId,
  resolvePricing,
  calculateCost,
};
