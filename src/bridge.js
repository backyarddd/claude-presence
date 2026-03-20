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

module.exports = { ensureDir, write, read, readAllSessions, remove, writePid, readPid };
