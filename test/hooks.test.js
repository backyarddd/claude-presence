const test = require('node:test');
const assert = require('node:assert');
const { setHookForEvent, extractOwnHooks } = require('../src/cli/setup');

const OURS = 'node "C:/nvm4w/nodejs/node_modules/claude-presence/src/hooks/post-tool-use.js"';
const STALE = 'node "C:/old/claude-presence/src/hooks/post-tool-use.js"';
const ALSO_STALE = 'node "C:/other/claude-presence/src/hooks/post-tool-use.js"';
const USER = 'node "C:/Users/me/lint.js"';
const LOOKALIKE = 'node "/home/me/dev/claude-presence-extras/mylog.js"';

const entry = (command, extra = {}) => ({ ...extra, hooks: [{ type: 'command', command }] });
const commands = (settings, event) =>
  (settings.hooks[event] || []).flatMap((e) => e.hooks.map((h) => h.command));

test('installs into empty settings', () => {
  const settings = {};
  assert.strictEqual(setHookForEvent(settings, 'PostToolUse', OURS), 'added');
  assert.deepStrictEqual(commands(settings, 'PostToolUse'), [OURS]);
});

test('re-running is a no-op', () => {
  const settings = {};
  setHookForEvent(settings, 'PostToolUse', OURS);
  const before = JSON.stringify(settings);
  assert.strictEqual(setHookForEvent(settings, 'PostToolUse', OURS), 'unchanged');
  assert.strictEqual(JSON.stringify(settings), before);
});

test('repoints a stale path', () => {
  const settings = { hooks: { PostToolUse: [entry(STALE)] } };
  assert.strictEqual(setHookForEvent(settings, 'PostToolUse', OURS), 'updated');
  assert.deepStrictEqual(commands(settings, 'PostToolUse'), [OURS]);
});

test('collapses duplicates from earlier installs', () => {
  const settings = { hooks: { PostToolUse: [entry(STALE), entry(ALSO_STALE)] } };
  assert.strictEqual(setHookForEvent(settings, 'PostToolUse', OURS), 'updated');
  assert.deepStrictEqual(commands(settings, 'PostToolUse'), [OURS]);
});

test('keeps user hooks that live in their own entries', () => {
  const settings = { hooks: { PostToolUse: [entry(USER, { matcher: 'Edit' }), entry(STALE)] } };
  setHookForEvent(settings, 'PostToolUse', OURS);
  assert.deepStrictEqual(commands(settings, 'PostToolUse'), [USER, OURS]);
  assert.strictEqual(settings.hooks.PostToolUse[0].matcher, 'Edit');
});

test('keeps user hooks that share an entry with ours', () => {
  const settings = {
    hooks: {
      PostToolUse: [
        { matcher: 'Bash', hooks: [{ command: STALE }, { command: USER }] },
        { matcher: 'Edit', hooks: [{ command: 'node "C:/me/formatter.js"' }, { command: ALSO_STALE }] },
      ],
    },
  };
  assert.strictEqual(setHookForEvent(settings, 'PostToolUse', OURS), 'updated');
  assert.deepStrictEqual(commands(settings, 'PostToolUse'), [USER, 'node "C:/me/formatter.js"', OURS]);
});

test('never adopts a matcher from an entry it repoints', () => {
  const settings = { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ command: STALE }] }] } };
  setHookForEvent(settings, 'PostToolUse', OURS);
  const ourEntry = settings.hooks.PostToolUse.find((e) => e.hooks.some((h) => h.command === OURS));
  assert.strictEqual(ourEntry.matcher, undefined);
});

test('leaves a lookalike user hook alone', () => {
  const settings = { hooks: { PostToolUse: [entry(LOOKALIKE, { matcher: 'Write' })] } };
  assert.strictEqual(setHookForEvent(settings, 'PostToolUse', OURS), 'added');
  assert.deepStrictEqual(commands(settings, 'PostToolUse'), [LOOKALIKE, OURS]);
});

test('survives hand-edited settings with non-array shapes', () => {
  const settings = { hooks: { PostToolUse: { bogus: true } } };
  assert.strictEqual(setHookForEvent(settings, 'PostToolUse', OURS), 'added');
  assert.deepStrictEqual(commands(settings, 'PostToolUse'), [OURS]);

  const malformed = { hooks: { Stop: [{ hooks: 'not-an-array' }, null] } };
  assert.strictEqual(setHookForEvent(malformed, 'Stop', OURS), 'added');
});

test('extractOwnHooks is the exact inverse used by uninstall', () => {
  const entries = [
    { matcher: 'Bash', hooks: [{ command: OURS }, { command: USER }] },
    entry(STALE),
    entry(LOOKALIKE),
  ];
  const removed = extractOwnHooks(entries);
  assert.deepStrictEqual(removed.sort(), [OURS, STALE].sort());
  assert.deepStrictEqual(
    entries.flatMap((e) => e.hooks.map((h) => h.command)),
    [USER, LOOKALIKE]
  );
});
