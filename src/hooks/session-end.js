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

    // Kill the daemon
    const pid = bridge.readPid(sessionId);
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process already dead - that's fine
      }
    }

    // Clean up bridge files
    bridge.remove(sessionId);
  } catch {
    // Never break Claude Code
  }
}

main().then(() => process.exit(0));
