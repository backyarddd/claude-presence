#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const config = require('./config');
const bridge = require('./bridge');
const DiscordPresence = require('./discord');

const sessionId = process.argv[2];
if (!sessionId) {
  process.exit(1);
}

// Write PID so session-end can kill us
bridge.writePid(sessionId, process.pid);

const discord = new DiscordPresence();
let idleTimer = null;
let orphanTimer = null;

function formatTokens(n) {
  if (n == null) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function activityToImageKey(status) {
  switch (status) {
    case 'coding': return config.IMAGE_KEYS.coding;
    case 'thinking': return config.IMAGE_KEYS.thinking;
    case 'idle':
    default: return config.IMAGE_KEYS.idle;
  }
}

function activityToSmallText(activity) {
  if (!activity) return 'Claude Code';
  if (activity.detail) return activity.detail;
  switch (activity.status) {
    case 'coding': return 'Working...';
    case 'thinking': return 'Thinking...';
    case 'idle': return 'Waiting for input';
    default: return 'Claude Code';
  }
}

function aggregateSessions() {
  const allSessions = bridge.readAllSessions();
  if (allSessions.length === 0) return null;

  // Find the most recently active session (by activity.updated_at or timestamp)
  const sorted = allSessions.sort((a, b) => {
    const aTime = a.activity?.updated_at || a.timestamp || 0;
    const bTime = b.activity?.updated_at || b.timestamp || 0;
    return bTime - aTime;
  });

  const primary = sorted[0];
  const sessionCount = allSessions.length;

  // Aggregate totals across all sessions
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCost = 0;
  let earliestStart = Infinity;

  for (const session of allSessions) {
    totalTokensIn += session.tokens?.in || 0;
    totalTokensOut += session.tokens?.out || 0;
    totalCost += session.cost_usd || 0;

    const start = session.session_start || Infinity;
    if (start < earliestStart) earliestStart = start;
  }

  return {
    primary,
    sessionCount,
    totals: {
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      tokens_total: totalTokensIn + totalTokensOut,
      cost_usd: totalCost,
      earliest_start: earliestStart === Infinity ? null : earliestStart,
    },
  };
}

function buildPresence(aggregated) {
  if (!aggregated) return null;

  const { primary, sessionCount, totals } = aggregated;
  const project = primary.workspace?.project || 'Unknown';
  const branch = primary.workspace?.branch;

  // Details line: project info + instance count
  let details;
  if (sessionCount > 1) {
    details = branch
      ? `Working on ${project} (${branch}) [${sessionCount} sessions]`
      : `Working on ${project} [${sessionCount} sessions]`;
  } else {
    details = branch ? `Working on ${project} (${branch})` : `Working on ${project}`;
  }

  // State line: aggregated cost, tokens, model
  const cost = `$${totals.cost_usd.toFixed(2)}`;
  const tokens = formatTokens(totals.tokens_total);
  const model = primary.model || 'Claude';
  const state = `${cost} | ${tokens} tokens | ${model}`;

  const presence = {
    details: details.slice(0, 128),
    state: state.slice(0, 128),
    largeImageKey: config.IMAGE_KEYS.large,
    largeImageText: sessionCount > 1
      ? `${sessionCount} sessions | ${formatTokens(totals.tokens_in)} in / ${formatTokens(totals.tokens_out)} out`
      : (primary.version ? `Claude Code v${primary.version}` : 'Claude Code'),
    smallImageKey: activityToImageKey(primary.activity?.status),
    smallImageText: activityToSmallText(primary.activity).slice(0, 128),
    buttons: [{ label: 'Claude Code', url: 'https://claude.ai/code' }],
  };

  // Elapsed timer from earliest session start
  const startTime = totals.earliest_start;
  if (startTime) {
    presence.startTimestamp = new Date(
      typeof startTime === 'number' && startTime < 1e12
        ? startTime * 1000
        : startTime
    );
  }

  return presence;
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const data = bridge.read(sessionId);
    if (data) {
      bridge.write(sessionId, {
        activity: { status: 'idle', detail: 'Waiting for input', tool: null, updated_at: Math.floor(Date.now() / 1000) },
      });
    }
  }, config.IDLE_TIMEOUT_MS);
}

function resetOrphanTimer() {
  if (orphanTimer) clearTimeout(orphanTimer);
  orphanTimer = setTimeout(() => {
    cleanup();
    process.exit(0);
  }, config.ORPHAN_TIMEOUT_MS);
}

async function onBridgeChange() {
  const myData = bridge.read(sessionId);
  if (!myData) return;

  resetIdleTimer();
  resetOrphanTimer();

  // Aggregate all sessions and build presence
  const aggregated = aggregateSessions();
  const presence = buildPresence(aggregated);
  if (presence) {
    await discord.setActivity(presence);
  }
}

async function cleanup() {
  if (idleTimer) clearTimeout(idleTimer);
  if (orphanTimer) clearTimeout(orphanTimer);

  try { fs.unwatchFile(config.bridgePath(sessionId)); } catch {}

  // If we're the last session, clear Discord presence
  const remaining = bridge.readAllSessions().filter((s) => s.session_id !== sessionId);
  if (remaining.length === 0) {
    await discord.destroy();
  } else {
    // Other sessions exist - update presence without us, then disconnect
    const aggregated = aggregateSessions();
    if (aggregated) {
      // Remove our data from aggregation
      const otherSessions = bridge.readAllSessions().filter((s) => s.session_id !== sessionId);
      if (otherSessions.length > 0) {
        // Let another daemon handle it - just disconnect cleanly
        await discord.destroy();
      }
    } else {
      await discord.destroy();
    }
  }

  // Remove PID file
  try { fs.unlinkSync(config.pidPath(sessionId)); } catch {}
}

async function main() {
  // Connect to Discord
  await discord.connect();

  // Watch our own bridge file for changes
  const bridgeFile = config.bridgePath(sessionId);
  fs.watchFile(bridgeFile, { interval: config.WATCH_INTERVAL_MS }, () => {
    onBridgeChange().catch(() => {});
  });

  // Also watch the bridge directory for new/removed sessions
  try {
    fs.watch(config.BRIDGE_DIR, (eventType, filename) => {
      if (filename && filename.startsWith('session-') && filename.endsWith('.json')) {
        onBridgeChange().catch(() => {});
      }
    });
  } catch {
    // fs.watch not supported - fall back to own file only
  }

  // Initial read
  await onBridgeChange();

  // Start orphan protection
  resetOrphanTimer();

  // Graceful shutdown
  const shutdown = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('exit', () => {
    try { fs.unlinkSync(config.pidPath(sessionId)); } catch {}
  });
}

main().catch(() => process.exit(1));
