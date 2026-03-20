#!/usr/bin/env node
const { execSync } = require('child_process');

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
  let raw = '';
  try {
    raw = await readStdin(3000);
    if (!raw) return;

    const input = JSON.parse(raw);
    const sessionId = input.session_id;

    if (sessionId) {
      const bridge = require('./bridge');

      const bridgeData = {
        timestamp: Math.floor(Date.now() / 1000),
      };

      // Model info
      if (input.model) {
        bridgeData.model = input.model.display_name || input.model.id || 'Claude';
        bridgeData.version = input.version;
      }

      // Token usage
      if (input.context_window) {
        const cw = input.context_window;
        bridgeData.tokens = {
          in: cw.total_input_tokens || 0,
          out: cw.total_output_tokens || 0,
          total: (cw.total_input_tokens || 0) + (cw.total_output_tokens || 0),
        };
        bridgeData.context_remaining_pct = cw.remaining_percentage;
      }

      // Cost
      if (input.cost) {
        bridgeData.cost_usd = input.cost.total_cost_usd || 0;
      }

      bridge.write(sessionId, bridgeData);
    }
  } catch {
    // Don't let bridge errors break the statusline
  }

  // Chain to original statusline
  try {
    const config = require('./config');
    const originalCmd = config.getOriginalStatusline();

    if (originalCmd && raw) {
      const output = execSync(originalCmd, {
        input: raw,
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      process.stdout.write(output);
    }
  } catch {
    // If original statusline fails, output nothing rather than crash
  }
}

main().then(() => process.exit(0));
