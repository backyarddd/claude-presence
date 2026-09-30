const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDir() {
  fs.mkdirSync(config.BRIDGE_DIR, { recursive: true });
}

function write(sessionId, partialData) {
  ensureDir();
  const filePath = config.bridgePath(sessionId);
  const tmpPath = filePath + '.tmp';

  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // File doesn't exist or is corrupted - start fresh
  }

  // Deep merge activity object, shallow merge everything else
  const merged = { ...existing, ...partialData };
  if (existing.activity && partialData.activity) {
    merged.activity = { ...existing.activity, ...partialData.activity };
  }

  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function read(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(config.bridgePath(sessionId), 'utf8'));
  } catch {
    return null;
  }
}

function remove(sessionId) {
  try { fs.unlinkSync(config.bridgePath(sessionId)); } catch {}
  try { fs.unlinkSync(config.bridgePath(sessionId) + '.tmp'); } catch {}
  try { fs.unlinkSync(config.pidPath(sessionId)); } catch {}
}

function writePid(sessionId, pid) {
  ensureDir();
  fs.writeFileSync(config.pidPath(sessionId), String(pid));
}

function readPid(sessionId) {
  try {
    return parseInt(fs.readFileSync(config.pidPath(sessionId), 'utf8').trim(), 10);
  } catch {
    return null;
  }
}

function readAllSessions() {
  const sessions = [];
  try {
    const files = fs.readdirSync(config.BRIDGE_DIR);
    for (const file of files) {
      if (file.startsWith('session-') && file.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(config.BRIDGE_DIR, file), 'utf8'));
          if (data) sessions.push(data);
        } catch {}
      }
    }
  } catch {}
  return sessions;
}

function isAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// [patch] Respawn the daemon if it is not running (it used to start only on SessionStart,
// so a crash or Discord restart killed presence for the rest of the session).
function ensureDaemon(sessionId, cwd) {
  try {
    const data = read(sessionId) || {};
    if (!data.workspace && cwd) {
      write(sessionId, {
        session_id: sessionId,
        session_start: data.session_start || Date.now(),
        workspace: { project: path.basename(cwd), branch: null, dir: cwd },
      });
    }
    if (isAlive(readPid(sessionId))) return;
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'daemon.js'), sessionId], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    writePid(sessionId, child.pid);
    child.unref();
  } catch {}
}

module.exports = { ensureDir, write, read, readAllSessions, remove, writePid, readPid, isAlive, ensureDaemon };
