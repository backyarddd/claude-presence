const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../src/config');
const bridge = require('../src/bridge');
const { collectUsage } = require('../src/usage');

let counter = 0;

function setup(t) {
  counter += 1;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-usage-'));
  const sessionId = `test-${process.pid}-${Date.now()}-${counter}`;
  const transcript = path.join(tmp, `${sessionId}.jsonl`);
  const subDir = path.join(tmp, sessionId, 'subagents');
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    bridge.remove(sessionId);
  });
  return { tmp, sessionId, transcript, subDir };
}

function assistant(id, req, usage, model = 'claude-opus-5-5') {
  return JSON.stringify({ type: 'assistant', requestId: req, message: { id, model, usage } });
}

function close(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
}

test('calculateUsageCost prices each token class', () => {
  const M = 1_000_000;
  const m = 'claude-opus-5-5';
  close(config.calculateUsageCost(m, { input_tokens: M }), 4);
  close(config.calculateUsageCost(m, { output_tokens: M }), 20);
  close(config.calculateUsageCost(m, { cache_read_input_tokens: M }), 0.2);
  close(config.calculateUsageCost(m, {
    cache_creation_input_tokens: M,
    cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: 0 },
  }), 5);
  close(config.calculateUsageCost(m, {
    cache_creation_input_tokens: M,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: M },
  }), 8);
});

test('calculateUsageCost without TTL breakdown bills 5m', () => {
  close(config.calculateUsageCost('claude-opus-5-5', { cache_creation_input_tokens: 1_000_000 }), 5);
});

test('fast mode doubles', () => {
  close(config.calculateUsageCost('claude-opus-5-5', { input_tokens: 1_000_000, speed: 'fast' }), 8);
});

test('Haiku 5.5 long prompt tier', () => {
  close(config.calculateUsageCost('claude-haiku-5-5', { input_tokens: 100_000 }), 0.01);
  close(config.calculateUsageCost('claude-haiku-5-5', { input_tokens: 100_001 }), (100_001 * 0.5) / 1e6);
});

test('Fable 5.2 cache read', () => {
  close(config.calculateUsageCost('claude-fable-5-2', { cache_read_input_tokens: 1_000_000 }), 0.2);
});

test('malformed usage is zero', () => {
  assert.strictEqual(config.calculateUsageCost('claude-opus-5-5', null), 0);
  assert.strictEqual(config.calculateUsageCost('claude-opus-5-5', 'str'), 0);
  assert.strictEqual(config.calculateUsageCost('claude-opus-5-5', { input_tokens: -5, output_tokens: NaN }), 0);
});

test('sums main and subagent transcripts, deduping responses', (t) => {
  const { transcript, subDir, sessionId } = setup(t);
  const u1 = { input_tokens: 10, output_tokens: 5 };
  const u2 = {
    input_tokens: 1,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 50,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 },
    output_tokens: 7,
  };
  const u3 = { input_tokens: 3, output_tokens: 2 };
  const lines = [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    assistant('m1', 'r1', u1),
    assistant('m1', 'r1', u1),
    assistant('m2', 'r2', u2),
    '{"type":"assistant","usage":',
  ];
  fs.writeFileSync(transcript, lines.join('\n') + '\n');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, 'agent-a.jsonl'), assistant('s1', 'q1', u3, 'claude-sonnet-5-5') + '\n');
  fs.writeFileSync(path.join(subDir, 'agent-a.meta.json'), '{"usage": 1}');

  const result = collectUsage(sessionId, transcript);
  assert.deepStrictEqual(result.tokens, { in: 164, out: 14, cache_read: 100, cache_write: 50, total: 178 });
  const expected = config.calculateUsageCost('claude-opus-5-5', u1)
    + config.calculateUsageCost('claude-opus-5-5', u2)
    + config.calculateUsageCost('claude-sonnet-5-5', u3);
  close(result.cost_usd, expected, 1e-12);
});

test('main transcript only when there is no subagents directory', (t) => {
  const { transcript, sessionId } = setup(t);
  fs.writeFileSync(transcript, assistant('m1', 'r1', { output_tokens: 3 }) + '\n');
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 3);
});

test('later usage for the same response replaces the earlier one', (t) => {
  const { transcript, sessionId } = setup(t);
  fs.writeFileSync(transcript, [
    assistant('m1', 'r1', { output_tokens: 5 }),
    assistant('m1', 'r1', { output_tokens: 9 }),
  ].join('\n') + '\n');
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 9);
});

test('lines without message id are not deduped', (t) => {
  const { transcript, sessionId } = setup(t);
  const line = JSON.stringify({ type: 'assistant', requestId: 'r1', message: { model: 'claude-opus-5-5', usage: { output_tokens: 4 } } });
  fs.writeFileSync(transcript, [line, line].join('\n') + '\n');
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 8);
});

test('incremental read picks up appended lines and waits for a full line', (t) => {
  const { transcript, sessionId } = setup(t);
  const first = assistant('m1', 'r1', { output_tokens: 5 }) + '\n';
  fs.writeFileSync(transcript, first);
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 5);
  // Blank out the scanned bytes: a full rescan would lose the 5, an incremental read keeps it.
  fs.writeFileSync(transcript, ' '.repeat(Buffer.byteLength(first) - 1) + '\n');

  const partial = '{"type":"assistant","requestId":"r4","message":{"id":"m4","usage":{"output_tokens":100}}';
  const complete = assistant('m3', 'r3', { output_tokens: 1 }) + '\n';
  fs.appendFileSync(transcript, complete + partial);
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 6);

  const state = JSON.parse(fs.readFileSync(config.usagePath(sessionId), 'utf8'));
  const text = fs.readFileSync(transcript);
  assert.strictEqual(state.files[transcript].offset, text.lastIndexOf(0x0a) + 1);

  fs.appendFileSync(transcript, '}\n');
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 106);
});

test('rewritten transcript is recounted', (t) => {
  const { transcript, sessionId } = setup(t);
  fs.writeFileSync(transcript, assistant('m1', 'r1', { output_tokens: 5 }) + '\n');
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 5);
  const shorter = assistant('z', 'z', { output_tokens: 2 }) + '\n';
  assert.ok(Buffer.byteLength(shorter) < fs.statSync(transcript).size);
  fs.writeFileSync(transcript, shorter);
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 2);
});

test('records from another session are not counted', (t) => {
  const { transcript, subDir, sessionId } = setup(t);
  const own = (id, out) => JSON.stringify({ type: 'assistant', sessionId, requestId: id, message: { id, model: 'claude-opus-5-5', usage: { output_tokens: out } } });
  fs.writeFileSync(transcript, own('m1', 5) + '\n');
  fs.mkdirSync(subDir, { recursive: true });
  // A fork's hardlinked copy of the parent's subagent transcript keeps the parent's id.
  const parent = JSON.stringify({ type: 'assistant', sessionId: 'parent-session', requestId: 'p1', message: { id: 'p1', model: 'claude-opus-5-5', usage: { output_tokens: 1000 } } });
  fs.writeFileSync(path.join(subDir, 'agent-parent.jsonl'), parent + '\n');
  fs.writeFileSync(path.join(subDir, 'agent-own.jsonl'), own('s1', 7) + '\n');
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 12);
});

test('a failed state save still returns totals and leaves no tmp file', (t) => {
  const { transcript, sessionId } = setup(t);
  const statePath = config.usagePath(sessionId);
  fs.mkdirSync(statePath, { recursive: true }); // rename onto a directory fails
  t.after(() => fs.rmSync(statePath, { recursive: true, force: true }));
  fs.writeFileSync(transcript, assistant('m1', 'r1', { output_tokens: 5 }) + '\n');
  assert.strictEqual(collectUsage(sessionId, transcript).tokens.out, 5);
  assert.strictEqual(fs.existsSync(`${statePath}.${process.pid}.tmp`), false);
});

test('missing transcript returns null', (t) => {
  const { tmp, sessionId } = setup(t);
  for (const p of [undefined, '', 42, path.join(tmp, 'nope.jsonl')]) {
    assert.strictEqual(collectUsage(sessionId, p), null);
  }
});
