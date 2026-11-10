const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../src/config');
const bridge = require('../src/bridge');

const ROOT = path.resolve(__dirname, '..');
let counter = 0;

function setup(t) {
  counter += 1;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-statusline-'));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-statusline-cfg-'));
  const sessionId = `test-sl-${process.pid}-${Date.now()}-${counter}`;
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
    bridge.remove(sessionId);
  });
  return { tmp, configDir, sessionId };
}

// Empty CLAUDE_CONFIG_DIR so the script never chains to the user's real statusline.
function runStatusline(payload, configDir) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'src', 'statusline.js')], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, res.stderr);
}

test('statusline writes transcript tokens and the larger cost', (t) => {
  const { tmp, configDir, sessionId } = setup(t);
  const transcript = path.join(tmp, `${sessionId}.jsonl`);
  const line = JSON.stringify({
    type: 'assistant',
    requestId: 'r1',
    message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 1000 } },
  });
  fs.writeFileSync(transcript, line + '\n');

  const payload = {
    session_id: sessionId,
    transcript_path: transcript,
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    cost: { total_cost_usd: 0.01 },
    context_window: { total_input_tokens: 5, total_output_tokens: 6, remaining_percentage: 90 },
  };
  runStatusline(payload, configDir);
  const data = bridge.read(sessionId);
  assert.strictEqual(data.tokens.in, 1000);
  assert.strictEqual(data.tokens.out, 1000);
  assert.strictEqual(data.tokens.total, 2000);
  assert.ok(Math.abs(data.cost_usd - 0.024) < 1e-9, String(data.cost_usd));
  assert.strictEqual(data.cost_estimated, false);
  assert.strictEqual(data.context_remaining_pct, 90);

  payload.cost.total_cost_usd = 5;
  runStatusline(payload, configDir);
  assert.strictEqual(bridge.read(sessionId).cost_usd, 5);
});

test('statusline falls back to context window without a transcript', (t) => {
  const { tmp, configDir, sessionId } = setup(t);
  runStatusline({
    session_id: sessionId,
    transcript_path: path.join(tmp, 'nope.jsonl'),
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    context_window: { total_input_tokens: 5, total_output_tokens: 6, remaining_percentage: 90 },
  }, configDir);
  const data = bridge.read(sessionId);
  assert.deepStrictEqual(data.tokens, { in: 5, out: 6, total: 11 });
  assert.strictEqual(data.cost_estimated, true);
  assert.strictEqual(data.cost_usd, config.calculateCost('claude-opus-5-5', 5, 6));
});
