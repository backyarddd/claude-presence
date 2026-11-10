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
// Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-10)
// The 1M-token context window is billed at standard rates. Cache writes bill at 1.25x
// input (5-minute TTL) or 2x (1-hour TTL); cache reads at `cacheRead` x input, 0.1x when
// unset. Fast mode bills every rate at 2x. Haiku 5.5 bills prompts over 100K tokens at
// the `longPrompt` rates.
const MODEL_PRICING = {
  'claude-fable-5-2':          { input:  8.00, output: 40.00, cacheRead: 0.025 },
  'claude-mythos-5-2':         { input:  8.00, output: 40.00, cacheRead: 0.025 },
  'claude-fable-5-1':          { input: 10.00, output: 50.00, cacheRead: 0.025 },
  'claude-mythos-5-1':         { input: 10.00, output: 50.00, cacheRead: 0.025 },
  'claude-fable-5':            { input: 10.00, output: 50.00 },
  'claude-mythos-5':           { input: 10.00, output: 50.00 },
  'claude-opus-5-5':           { input:  4.00, output: 20.00, cacheRead: 0.05 },
  'claude-opus-5':             { input:  5.00, output: 25.00 },
  'claude-opus-4-8':           { input:  5.00, output: 25.00 },
  'claude-opus-4-7':           { input:  5.00, output: 25.00 },
  'claude-opus-4-6':           { input:  5.00, output: 25.00 },
  'claude-opus-4-5':           { input:  5.00, output: 25.00 },
  'claude-opus-4-1':           { input: 15.00, output: 75.00 },
  'claude-opus-4-0':           { input: 15.00, output: 75.00 },
  'claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'claude-sonnet-5-5':         { input:  2.00, output: 10.00, cacheRead: 0.05 },
  'claude-sonnet-5':           { input:  2.00, output: 10.00 },
  'claude-sonnet-4-6':         { input:  3.00, output: 15.00 },
  'claude-sonnet-4-5':         { input:  3.00, output: 15.00 },
  'claude-sonnet-4-0':         { input:  3.00, output: 15.00 },
  'claude-sonnet-4-20250514':  { input:  3.00, output: 15.00 },
  'claude-haiku-5-5':          { input:  0.10, output:  0.50, longPrompt: { threshold: 100_000, input: 0.50, output: 2.50 } }, // cache-read rate not published separately; billed at the 0.1x default
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

const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;
const DEFAULT_CACHE_READ_MULTIPLIER = 0.1;
const FAST_MODE_MULTIPLIER = 2;

function calculateUsageCost(modelId, usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const input = n(usage.input_tokens);
  const cacheRead = n(usage.cache_read_input_tokens);
  const output = n(usage.output_tokens);
  const writeTotal = n(usage.cache_creation_input_tokens);
  const breakdown = usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : null;
  const write1h = breakdown ? n(breakdown.ephemeral_1h_input_tokens) : 0;
  // Without a TTL breakdown (older Claude Code), bill all writes at the 5-minute rate.
  let write5m = breakdown ? n(breakdown.ephemeral_5m_input_tokens) : writeTotal;
  const unattributed = writeTotal - write1h - write5m;
  if (unattributed > 0) write5m += unattributed;
  const pricing = resolvePricing(modelId);
  const promptTokens = input + cacheRead + write5m + write1h;
  const rates = pricing.longPrompt && promptTokens > pricing.longPrompt.threshold ? pricing.longPrompt : pricing;
  const readMultiplier = pricing.cacheRead ?? DEFAULT_CACHE_READ_MULTIPLIER;
  const speed = usage.speed === 'fast' ? FAST_MODE_MULTIPLIER : 1;
  const cost = input * rates.input
    + write5m * rates.input * CACHE_WRITE_5M_MULTIPLIER
    + write1h * rates.input * CACHE_WRITE_1H_MULTIPLIER
    + cacheRead * rates.input * readMultiplier
    + output * rates.output;
  return (speed * cost) / 1_000_000;
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

function usagePath(sessionId) {
  return path.join(BRIDGE_DIR, `usage-${sessionId}.json`);
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
  usagePath,
  getPresenceConfig,
  savePresenceConfig,
  getOriginalStatusline,
  MODEL_PRICING,
  DEFAULT_PRICING,
  normalizeModelId,
  resolvePricing,
  calculateCost,
  calculateUsageCost,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
  DEFAULT_CACHE_READ_MULTIPLIER,
  FAST_MODE_MULTIPLIER,
};
