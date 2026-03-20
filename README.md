# claude-presence

Discord Rich Presence for [Claude Code](https://claude.ai/code) CLI. Automatically shows your AI coding session on your Discord profile - what you're working on, which model, token usage, cost, and more.

![Discord](https://img.shields.io/badge/Discord-Rich%20Presence-5865F2?style=flat&logo=discord&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)

## What It Shows

Your Discord profile displays real-time info from your Claude Code session:

| Field | Example | Source |
|-------|---------|--------|
| **Project** | `Working on my-app (main)` | Git directory + branch |
| **Model** | `Opus`, `Sonnet`, `Haiku` | Active Claude model |
| **Tokens** | `29.5k tokens` | Cumulative input + output |
| **Cost** | `$0.70` | Session cost in USD |
| **Elapsed** | `01:23:45 elapsed` | Auto-calculated by Discord |
| **Activity** | `Editing app.tsx` | What Claude is doing right now |
| **Status** | Coding / Thinking / Idle | Small icon overlay |
| **Sessions** | `[2 sessions]` | Multi-instance count |

### Multi-Session Support

Running multiple Claude Code instances? The presence automatically:
- Shows the count: `Working on my-app (main) [3 sessions]`
- Aggregates total tokens and cost across all sessions
- Displays the most recently active session's project and activity
- Shows per-session token breakdown on hover

## Quick Start

### 1. Install

```bash
npm install -g claude-presence
```

### 2. Set Up Discord Application

You need a free Discord Application for the images to show up. This takes about 2 minutes:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name (this is what shows on your profile, e.g. "ClaudePresence")
3. Copy the **Application ID** from the General Information page
4. Go to **Rich Presence** > **Art Assets** in the left sidebar
5. Upload these 4 images (included in the `assets/` folder of this repo):

| Asset Name | File | Description |
|-----------|------|-------------|
| `claude-logo` | `assets/claude-logo.png` | Main large image |
| `status-coding` | `assets/status-coding.png` | Small icon - coding |
| `status-thinking` | `assets/status-thinking.png` | Small icon - thinking |
| `status-idle` | `assets/status-idle.png` | Small icon - idle |

> **Important:** The asset names in Discord must match exactly: `claude-logo`, `status-coding`, `status-thinking`, `status-idle`

6. Set your Application ID as an environment variable. Add this to your shell profile (`~/.bashrc`, `~/.zshrc`, PowerShell `$PROFILE`, etc.):

```bash
# Bash / Zsh
export CLAUDE_PRESENCE_CLIENT_ID="your-application-id-here"
```

```powershell
# PowerShell
$env:CLAUDE_PRESENCE_CLIENT_ID = "your-application-id-here"
```

### 3. Install Hooks

```bash
claude-presence setup
```

That's it. Start a new Claude Code session and check your Discord profile.

## Commands

| Command | Description |
|---------|-------------|
| `claude-presence setup` | Install hooks into Claude Code settings |
| `claude-presence uninstall` | Remove all hooks and restore original settings |
| `claude-presence status` | Show hook status, active sessions, and diagnostics |
| `claude-presence --version` | Show version |
| `claude-presence --help` | Show help |

## How It Works

claude-presence uses Claude Code's [hook system](https://docs.anthropic.com/en/docs/claude-code/hooks) to capture session data without modifying Claude Code itself.

### Architecture

```
Claude Code
  |
  |-- SessionStart hook ----> Spawns background daemon
  |-- StatusLine hook ------> Captures tokens, cost, model, context %
  |-- PostToolUse hook -----> Tracks activity (editing, searching, running)
  |-- Stop hook ------------> Detects idle state
  |-- SessionEnd hook ------> Kills daemon, cleans up
  |
  v
Bridge File (JSON)  <------>  Background Daemon  ------>  Discord RPC
(temp directory)               (watches for changes)      (named pipe)
```

### Components

| Component | Description |
|-----------|-------------|
| **Hook scripts** | Short-lived Node.js scripts invoked by Claude Code on events. They read event data from stdin and write to a JSON bridge file. |
| **Bridge file** | A JSON file in your temp directory (`%TEMP%/claude-presence/` or `/tmp/claude-presence/`). Each session gets its own file. Hooks write to it, the daemon reads from it. |
| **Background daemon** | A long-running Node.js process that watches the bridge file and pushes updates to Discord via RPC. One daemon per session. |
| **StatusLine wrapper** | Captures rich session data (model, tokens, cost) and chains to your existing statusline so nothing breaks. |

### Activity Detection

The `PostToolUse` hook maps Claude's tools to human-readable activity:

| Claude Tool | Discord Shows |
|------------|---------------|
| `Edit` / `Write` | Editing filename.ts |
| `Read` | Reading filename.ts |
| `Bash` | Running terminal command |
| `Grep` / `Glob` | Searching codebase |
| `WebSearch` | Searching the web |
| `WebFetch` | Fetching web content |
| `Agent` | Running subagent |
| (idle) | Waiting for input |

## Features

- **Zero config after setup** - hooks activate automatically on every Claude Code session
- **Non-destructive** - works alongside existing hooks (GSD, custom hooks, etc.)
- **StatusLine chaining** - preserves your existing statusline output
- **Multi-session aggregation** - tracks all concurrent instances, shows totals
- **Graceful degradation** - if Discord isn't running, hooks work silently with no errors
- **Auto-reconnect** - daemon reconnects to Discord if it restarts mid-session
- **Orphan protection** - daemon self-terminates if session dies unexpectedly (10 min timeout)
- **Idempotent setup** - safe to run `setup` multiple times
- **Clean uninstall** - restores your original settings exactly

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_PRESENCE_CLIENT_ID` | Your Discord Application ID | Built-in default |
| `CLAUDE_CONFIG_DIR` | Custom Claude config directory | `~/.claude` |

### What Setup Modifies

`claude-presence setup` adds entries to `~/.claude/settings.json`:

- Adds hooks to `SessionStart`, `PostToolUse`, `Stop`, and `SessionEnd` arrays
- Replaces `statusLine` with a wrapper that captures data and chains to your original

Your original statusline command is saved to `~/.claude/claude-presence.json` and fully restored on `uninstall`.

## Uninstall

```bash
claude-presence uninstall
npm uninstall -g claude-presence
```

This:
1. Removes all claude-presence hooks from `settings.json`
2. Restores your original statusline
3. Kills any running daemons
4. Cleans up bridge files and config

## Troubleshooting

### Presence not showing on Discord

1. **Discord desktop app must be running** - Rich Presence doesn't work with Discord in browser
2. **Check hooks are installed:** `claude-presence status`
3. **Check Client ID is set:** `echo $CLAUDE_PRESENCE_CLIENT_ID`
4. **Start a new session** - hooks only activate on session start, not mid-session
5. **Check Discord settings** - Make sure "Activity Status" is enabled in Discord Settings > Activity Privacy

### StatusLine broken after install

```bash
claude-presence uninstall
claude-presence setup
```

This re-saves your original statusline and re-chains it.

### Presence shows wrong project

Each session gets its own daemon. The most recently active session's project is displayed. If you have multiple sessions, the `[N sessions]` badge appears.

### Presence stuck / not clearing

```bash
# Check for orphaned daemons
claude-presence status

# Force cleanup
claude-presence uninstall
```

### Hooks not firing

Make sure your `~/.claude/settings.json` has the hook entries. Run `claude-presence setup` to re-install them.

## Requirements

- **Node.js** >= 18
- **Discord** desktop app (not browser)
- **Claude Code** CLI

## File Structure

```
claude-presence/
├── package.json              # npm package config
├── bin/
│   └── cli.js                # CLI entry point
├── src/
│   ├── config.js             # Constants and paths
│   ├── bridge.js             # Bridge file I/O (atomic writes)
│   ├── discord.js            # Discord RPC wrapper with auto-reconnect
│   ├── daemon.js             # Background process
│   ├── statusline.js         # StatusLine wrapper with chaining
│   ├── hooks/
│   │   ├── session-start.js  # Spawns daemon
│   │   ├── session-end.js    # Kills daemon
│   │   ├── post-tool-use.js  # Tracks activity
│   │   └── stop.js           # Detects idle
│   └── cli/
│       ├── setup.js          # Installs hooks
│       └── uninstall.js      # Removes hooks
└── assets/
    ├── claude-logo.png       # Discord large image
    ├── status-coding.png     # Discord small image - coding
    ├── status-thinking.png   # Discord small image - thinking
    └── status-idle.png       # Discord small image - idle
```

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Test with `claude-presence setup` in a real Claude Code session
5. Submit a PR

## License

MIT
