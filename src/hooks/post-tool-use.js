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

function getActivityDetail(toolName, toolInput) {
  const getFilename = (p) => {
    if (!p) return '';
    const parts = p.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || p;
  };

  switch (toolName) {
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const file = getFilename(toolInput?.file_path);
      return file ? `Editing ${file}` : 'Editing a file';
    }
    case 'Read': {
      const file = getFilename(toolInput?.file_path);
      return file ? `Reading ${file}` : 'Reading a file';
    }
    case 'Bash':
      return 'Running terminal command';
    case 'Grep':
      return 'Searching codebase';
    case 'Glob':
      return 'Finding files';
    case 'WebSearch':
      return 'Searching the web';
    case 'WebFetch':
      return 'Fetching web content';
    case 'Agent':
      return 'Running subagent';
    case 'Skill':
      return 'Using a skill';
    default:
      return `Using ${toolName}`;
  }
}

async function main() {
  try {
    const raw = await readStdin(3000);
    if (!raw) return;

    const input = JSON.parse(raw);
    const sessionId = input.session_id;
    const toolName = input.tool_name;
    if (!sessionId || !toolName) return;

    const bridge = require('../bridge');
    bridge.write(sessionId, {
      timestamp: Math.floor(Date.now() / 1000),
      activity: {
        status: 'coding',
        detail: getActivityDetail(toolName, input.tool_input),
        tool: toolName,
        updated_at: Math.floor(Date.now() / 1000),
      },
    });
  } catch {
    // Never break Claude Code
  }
}

main().then(() => process.exit(0));
