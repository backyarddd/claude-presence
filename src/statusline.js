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
      const config = require('./config');

      const bridgeData = {
        timestamp: Math.floor(Date.now() / 1000),
      };

      // Model info
      const modelId = input.model?.id || '';
      if (input.model) {
        bridgeData.model = input.model.display_name || input.model.id || 'Claude';
        bridgeData.model_id = modelId;
        bridgeData.version = input.version;
      }

      // Token usage
      const tokensIn = input.context_window?.total_input_tokens || 0;
      const tokensOut = input.context_window?.total_output_tokens || 0;
      if (input.context_window) {
        bridgeData.tokens = {
          in: tokensIn,
          out: tokensOut,
          total: tokensIn + tokensOut,
        };
        bridgeData.context_remaining_pct = input.context_window.remaining_percentage;
      }

      // Cost - use Claude Code's value if available, otherwise calculate from tokens.
      // Always write both keys: bridge.write merges, so leaving them out would keep a
      // previous render's cost after a /clear resets the context window.
      if (input.cost && input.cost.total_cost_usd != null) {
        bridgeData.cost_usd = input.cost.total_cost_usd;
        bridgeData.cost_estimated = false;
      } else if (tokensIn || tokensOut) {
        bridgeData.cost_usd = config.calculateCost(modelId, tokensIn, tokensOut);
        bridgeData.cost_estimated = true;
      } else {
        bridgeData.cost_usd = 0;
        bridgeData.cost_estimated = false;
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

    // Never chain to one of our own scripts - a poisoned config would recurse.
    if (originalCmd && raw && !config.isOwnedCommand(originalCmd)) {
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
