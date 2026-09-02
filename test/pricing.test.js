const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const config = require('../src/config');

test('exact model ids resolve to list pricing', () => {
  assert.deepStrictEqual(config.resolvePricing('claude-opus-5'), { input: 5, output: 25 });
  assert.deepStrictEqual(config.resolvePricing('claude-sonnet-5'), { input: 2, output: 10 });
  assert.deepStrictEqual(config.resolvePricing('claude-fable-5-1'), { input: 10, output: 50 });
  assert.deepStrictEqual(config.resolvePricing('claude-haiku-4-5'), { input: 1, output: 5 });
});

test('context-tier suffix from Claude Code is stripped', () => {
  assert.deepStrictEqual(config.resolvePricing('claude-opus-5[1m]'), { input: 5, output: 25 });
  assert.deepStrictEqual(config.resolvePricing('claude-sonnet-5[1m]'), { input: 2, output: 10 });
});

test('dated snapshots and platform prefixes resolve', () => {
  assert.deepStrictEqual(config.resolvePricing('claude-haiku-4-5-20251001'), { input: 1, output: 5 });
  assert.deepStrictEqual(config.resolvePricing('claude-opus-4-5-20251101'), { input: 5, output: 25 });
  assert.deepStrictEqual(config.resolvePricing('claude-sonnet-4-20250514'), { input: 3, output: 15 });
  assert.deepStrictEqual(config.resolvePricing('anthropic.claude-opus-5'), { input: 5, output: 25 });
});

test('longer alias wins over a shorter one it contains', () => {
  assert.deepStrictEqual(config.resolvePricing('claude-fable-5'), { input: 10, output: 50 });
  assert.deepStrictEqual(config.resolvePricing('claude-fable-5-1'), { input: 10, output: 50 });
});

test('a trailing digit is a different model, not a snapshot', () => {
  // claude-opus-4-10 must not resolve through claude-opus-4-1 ($15/$75)
  assert.deepStrictEqual(config.resolvePricing('claude-opus-4-10'), config.DEFAULT_PRICING);
  assert.deepStrictEqual(config.resolvePricing('claude-sonnet-4-50'), config.DEFAULT_PRICING);
  // a trailing dash still resolves - that is a dated snapshot
  assert.deepStrictEqual(config.resolvePricing('claude-opus-4-1-20250805'), { input: 15, output: 75 });
});

test('unknown and malformed ids fall back without throwing', () => {
  for (const id of [null, undefined, 42, '', '   ', 'something-new']) {
    assert.deepStrictEqual(config.resolvePricing(id), config.DEFAULT_PRICING);
  }
});

test('cost is computed from the resolved rate', () => {
  // 1M input + 100k output on Opus 5 = $5.00 + $2.50
  assert.strictEqual(config.calculateCost('claude-opus-5[1m]', 1_000_000, 100_000), 7.5);
  assert.strictEqual(config.calculateCost('claude-haiku-4-5', 0, 0), 0);
  assert.strictEqual(config.calculateCost('claude-sonnet-5', null, undefined), 0);
});

test('isOwnedCommand claims this install and older claude-presence installs', () => {
  const here = path.resolve(__dirname, '..').replace(/\\/g, '/');
  assert.strictEqual(config.isOwnedCommand(`node "${here}/src/hooks/stop.js"`), true);
  assert.strictEqual(config.isOwnedCommand('node "C:/nvm4w/nodejs/node_modules/claude-presence/src/hooks/stop.js"'), true);
  assert.strictEqual(config.isOwnedCommand('node "C:\\old\\claude-presence\\src\\statusline.js"'), true);
});

test('isOwnedCommand does not claim unrelated user hooks', () => {
  assert.strictEqual(config.isOwnedCommand('node "C:/Users/me/lint.js"'), false);
  // merely mentioning claude-presence is not enough
  assert.strictEqual(config.isOwnedCommand('node "/home/me/dev/claude-presence-extras/mylog.js"'), false);
  assert.strictEqual(config.isOwnedCommand(undefined), false);
  assert.strictEqual(config.isOwnedCommand(42), false);
});
