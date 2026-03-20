#!/usr/bin/env node
const { spawn, execSync } = require('child_process');
const path = require('path');

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
    const cwd = input.cwd || process.cwd();
    if (!sessionId) return;

    // Detect project name and git branch
    const project = path.basename(cwd);
    let branch = 'unknown';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        timeout: 2000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }).trim();
    } catch {}

    // Write initial bridge state
    const bridge = require('../bridge');
    bridge.write(sessionId, {
      session_id: sessionId,
      session_start: Date.now(),
      timestamp: Math.floor(Date.now() / 1000),
      workspace: { project, branch, dir: cwd },
      activity: {
        status: 'idle',
        detail: 'Starting session',
        tool: null,
        updated_at: Math.floor(Date.now() / 1000),
      },
    });

    // Spawn daemon as detached background process
    const daemonPath = path.join(__dirname, '..', 'daemon.js');
    const child = spawn(process.execPath, [daemonPath, sessionId], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Never break Claude Code
  }
}

main().then(() => process.exit(0));
