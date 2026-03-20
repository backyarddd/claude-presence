#!/usr/bin/env node

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
    process.stdin.resume();
  });
}

async function main() {
  try {
    const raw = await readStdin(3000);
    if (!raw) return;

    const input = JSON.parse(raw);
    const sessionId = input.session_id;
    if (!sessionId) return;

    const bridge = require('../bridge');
    bridge.write(sessionId, {
      timestamp: Math.floor(Date.now() / 1000),
      activity: {
        status: 'idle',
        detail: 'Waiting for input',
        tool: null,
        updated_at: Math.floor(Date.now() / 1000),
      },
    });
  } catch {
    // Never break Claude Code
  }
}

main().then(() => process.exit(0));
