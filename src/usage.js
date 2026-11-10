const fs = require('fs');
const path = require('path');
const config = require('./config');

const STATE_VERSION = 1;
const CHUNK_BYTES = 16 * 1024 * 1024;

function emptyTotals() {
  return { input: 0, cache_write: 0, cache_read: 0, output: 0, cost_usd: 0 };
}

function freshEntry() {
  return { offset: 0, last_key: null, last: emptyTotals(), totals: emptyTotals() };
}

function contribution(model, usage) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  return {
    input: n(usage.input_tokens),
    cache_write: n(usage.cache_creation_input_tokens),
    cache_read: n(usage.cache_read_input_tokens),
    output: n(usage.output_tokens),
    cost_usd: config.calculateUsageCost(model, usage),
  };
}

function addInto(target, c, sign) {
  for (const k of Object.keys(target)) target[k] += sign * c[k];
}

// Main transcript first, then its subagent transcripts (flat directory; `.meta.json`
// files beside them are not transcripts).
function transcriptFiles(transcriptPath) {
  const subDir = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, '.jsonl'), 'subagents');
  let names;
  try {
    names = fs.readdirSync(subDir);
  } catch {
    return [transcriptPath];
  }
  const subs = names.filter((name) => name.endsWith('.jsonl')).sort().map((name) => path.join(subDir, name));
  return [transcriptPath, ...subs];
}

function processLines(text, entry, sessionId) {
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      // A corrupt line must not stop the count.
      continue;
    }
    if (!(rec && rec.type === 'assistant' && rec.message && rec.message.usage && typeof rec.message.usage === 'object')) continue;
    // A forked session hardlinks the parent's subagent transcripts, whose records keep the
    // parent's id; that spend belongs to the parent and would be counted twice on Discord.
    if (rec.sessionId && rec.sessionId !== sessionId) continue;
    const key = rec.message.id ? `${rec.message.id}|${rec.requestId ?? ''}` : null;
    const c = contribution(rec.message.model, rec.message.usage);
    if (key !== null && key === entry.last_key) {
      // One response spans several contiguous lines; keep only the latest usage.
      addInto(entry.totals, entry.last, -1);
    }
    addInto(entry.totals, c, 1);
    entry.last_key = key;
    entry.last = c;
  }
}

// Reads only the bytes after entry.offset. The offset covers complete lines only, so a
// line still being written is re-read next time. Splitting on the 0x0a byte keeps
// multi-byte UTF-8 intact.
// onProgress runs after each chunk, when offset and totals are consistent, so an
// interrupted first scan of a huge transcript resumes instead of restarting.
function scanFile(filePath, entry, sessionId, onProgress) {
  const size = fs.statSync(filePath).size;
  if (size < entry.offset) Object.assign(entry, freshEntry()); // file rewritten: recount
  if (size === entry.offset) return;

  const fd = fs.openSync(filePath, 'r');
  try {
    let pos = entry.offset;
    let leftover = Buffer.alloc(0);
    const buf = Buffer.alloc(Math.min(CHUNK_BYTES, size - pos));
    while (pos < size) {
      const bytesRead = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
      if (bytesRead === 0) break;
      pos += bytesRead;
      const data = leftover.length ? Buffer.concat([leftover, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      const nl = data.lastIndexOf(0x0a);
      if (nl === -1) {
        leftover = Buffer.from(data);
        continue;
      }
      processLines(data.subarray(0, nl).toString('utf8'), entry, sessionId);
      entry.offset += nl + 1;
      leftover = Buffer.from(data.subarray(nl + 1));
      onProgress();
    }
  } finally {
    fs.closeSync(fd);
  }
}

function loadState(sessionId, transcriptPath) {
  const fresh = { version: STATE_VERSION, transcript: transcriptPath, files: {} };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(config.usagePath(sessionId), 'utf8'));
  } catch {
    return fresh;
  }
  if (!state || typeof state !== 'object' || state.version !== STATE_VERSION
    || state.transcript !== transcriptPath || !state.files || typeof state.files !== 'object') {
    return fresh;
  }
  return state;
}

function saveState(sessionId, state) {
  fs.mkdirSync(config.BRIDGE_DIR, { recursive: true });
  const p = config.usagePath(sessionId);
  // pid suffix: concurrent statusline renders must not share a tmp file.
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, p);
  } catch {
    // The state file is only a cache: on Windows a rename racing another render fails with
    // EPERM. Totals stay correct and the next render resumes from the last saved offset.
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function collectUsage(sessionId, transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '' || !fs.existsSync(transcriptPath)) return null;

  const state = loadState(sessionId, transcriptPath);
  for (const file of transcriptFiles(transcriptPath)) {
    const entry = state.files[file] || freshEntry();
    try {
      scanFile(file, entry, sessionId, () => {
        state.files[file] = entry;
        saveState(sessionId, state);
      });
    } catch (err) {
      if (file !== transcriptPath && err && err.code === 'ENOENT') continue;
      throw err;
    }
    state.files[file] = entry;
  }

  // Entries for files no longer on disk still count: that spend happened.
  const sum = emptyTotals();
  for (const entry of Object.values(state.files)) addInto(sum, entry.totals, 1);
  const tokensIn = sum.input + sum.cache_write + sum.cache_read;
  return {
    tokens: {
      in: tokensIn,
      out: sum.output,
      cache_read: sum.cache_read,
      cache_write: sum.cache_write,
      total: tokensIn + sum.output,
    },
    cost_usd: sum.cost_usd,
  };
}

module.exports = { collectUsage };
