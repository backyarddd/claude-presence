# Discord Presence for Claude Code

Discord Rich Presence for [Claude Code](https://claude.ai/code) CLI. Automatically shows your AI coding session on your Discord profile.

![Discord](https://img.shields.io/badge/Discord-Rich%20Presence-5865F2?style=flat&logo=discord&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)

## Quick Start (2 commands)

**Works out of the box.** No Discord bot setup required - the app comes pre-configured with a shared Discord Application so you can start immediately.

```bash
npm install -g github:backyarddd/claude-presence
claude-presence setup
```

> **Install from GitHub, not from the npm name.** The `claude-presence` name on npm belongs to an unrelated package by a different author. Installing from GitHub requires `git` on your PATH.

That's it. Start a **new** Claude Code session and your Discord profile will show what you're working on. `setup` writes hooks into `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) and existing sessions do not pick them up until they restart.

## What It Shows

| Field | Example |
|-------|---------|
| **Project** | `Working on my-app (main)` |
| **Model** | `Opus`, `Sonnet`, `Haiku` |
| **Tokens** | `29.5k tokens` |
| **Cost** | `$0.70` |
| **Elapsed** | `01:23:45 elapsed` |
| **Activity** | `Editing app.tsx`, `Running bash`, `Searching codebase` |
| **Status icon** | Coding / Thinking / Idle |
| **Multi-session** | `[3 sessions]` with aggregated totals |

### Activity Detection

| What Claude Is Doing | Discord Shows |
|---------------------|---------------|
| Editing or writing files | `Editing filename.ts` |
| Reading files | `Reading filename.ts` |
| Running terminal commands | `Running terminal command` |
| Searching code (Grep/Glob) | `Searching codebase` |
| Web search or fetch | `Searching the web` |
| Running subagents | `Running subagent` |
| Waiting for you | `Waiting for input` |

### Multi-Session Support

Running multiple Claude Code instances? The presence automatically:
- Shows the count: `Working on my-app (main) [3 sessions]`
- Aggregates total tokens and cost across all sessions
- Displays the most recently active session's details
- Shows per-session token breakdown on hover

### Cost Calculation

Cost is calculated using current Claude API pricing (Dec 2025):

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| Opus 4.5 | $15.00 | $75.00 |
| Sonnet 4.5 | $3.00 | $15.00 |
| Sonnet 4 | $3.00 | $15.00 |
| Haiku 4.5 | $1.00 | $5.00 |

If Claude Code provides cost data directly, that value is used. Otherwise, cost is calculated from the token count and model pricing above.

## Commands

| Command | Description |
|---------|-------------|
| `claude-presence setup` | Install hooks into Claude Code |
| `claude-presence uninstall` | Remove everything and restore original settings |
| `claude-presence status` | Show hook status, active sessions, diagnostics |
| `claude-presence --help` | Show help |

## How It Works

claude-presence uses Claude Code's [hook system](https://docs.anthropic.com/en/docs/claude-code/hooks) to capture session data:

```
Claude Code
  |
  |-- SessionStart -----> Spawns background daemon
  |-- StatusLine -------> Captures tokens, cost, model
  |-- PostToolUse ------> Tracks activity (editing, searching, etc.)
  |-- Stop -------------> Detects idle state
  |-- SessionEnd -------> Kills daemon, cleans up
  |
  v
Bridge File (JSON)  <-->  Background Daemon  --->  Discord RPC
```

- **Hook scripts** are short-lived processes invoked by Claude Code on events
- **Bridge file** is a JSON file in your temp directory that hooks write to
- **Background daemon** watches the bridge file and pushes updates to Discord
- **StatusLine wrapper** chains with your existing statusline (GSD, etc.) so nothing breaks

## Features

- **Zero config** - works immediately after `npm install -g` and `setup`
- **Pre-configured Discord app** - no bot creation needed
- **Non-destructive** - works alongside existing hooks
- **StatusLine chaining** - preserves your existing statusline
- **Multi-session aggregation** - tracks all concurrent instances
- **Built-in cost calculation** - uses Claude API pricing when direct cost isn't available
- **Graceful degradation** - if Discord isn't running, no errors
- **Auto-reconnect** - daemon reconnects if Discord restarts
- **Orphan protection** - daemon self-terminates if session dies
- **Clean uninstall** - restores settings exactly as they were

## Advanced: Use Your Own Discord Application (Optional)

If you want to customize the app name, images, or run your own Discord Application:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it whatever you want (this shows on your Discord profile)
3. Copy the **Application ID**
4. Go to **Rich Presence** > **Art Assets** and upload these images. They are not shipped with the install, so download them from the [`assets/` folder in this repo](https://github.com/backyarddd/claude-presence/tree/main/assets):

| Asset Name (exact) | File | Description |
|-----------|------|-------------|
| `claude-logo` | `assets/claude-logo.png` | Main large image |
| `status-coding` | `assets/status-coding.png` | Small icon for coding |
| `status-thinking` | `assets/status-thinking.png` | Small icon for thinking |
| `status-idle` | `assets/status-idle.png` | Small icon for idle |

5. Set your Application ID as an environment variable:

```bash
# Bash / Zsh - add to ~/.bashrc or ~/.zshrc
export CLAUDE_PRESENCE_CLIENT_ID="your-application-id-here"
```

```powershell
# PowerShell - add to $PROFILE
$env:CLAUDE_PRESENCE_CLIENT_ID = "your-application-id-here"
```

This overrides the built-in default. Run `claude-presence setup` again if you already set up.

## Uninstall

```bash
claude-presence uninstall   # remove hooks first, while the CLI still exists
npm uninstall -g claude-presence
```

Restores your original Claude Code settings exactly as they were. Run `uninstall` **before** removing the package - the hook paths point at the installed files, so uninstalling the package first leaves dead hooks in `settings.json`.

## Updating

```bash
claude-presence uninstall
npm install -g github:backyarddd/claude-presence
claude-presence setup
```

`setup` skips hook events that already have a claude-presence hook, so it will not repair stale paths on its own. Run `uninstall` first whenever the install location may have moved.

## Troubleshooting

**Presence not showing:**
- Discord desktop app must be running (not browser)
- Run `claude-presence status` to check hooks are installed
- Start a **new** Claude Code session (hooks activate on session start)
- Check Discord Settings > Activity Privacy > "Display current activity" is enabled

**StatusLine broken after install:**
```bash
claude-presence uninstall
claude-presence setup
```

**Presence stuck or not clearing:**
```bash
claude-presence status    # check for orphaned daemons
claude-presence uninstall # force cleanup
```

**`claude-presence: command not found`:**
- npm's global bin directory is not on your PATH. Run `npm prefix -g` - that directory (or its `bin` subfolder on macOS/Linux) must be on your PATH.
- If you also have an older copy linked with `npm link`, it can shadow the global install. Check with `which -a claude-presence` (`where claude-presence` on Windows) and remove the stale one.

**Hooks broke after switching Node versions (nvm, fnm, volta):**
`setup` writes absolute paths to the installed package, and each Node version has its own global folder. Reinstall on the new version:
```bash
claude-presence uninstall
npm install -g github:backyarddd/claude-presence
claude-presence setup
```

## Requirements

- Node.js >= 18
- `git` (npm installs this package from GitHub)
- Discord desktop app
- Claude Code CLI

## License

MIT

Status icons from [Heroicons](https://heroicons.com) (MIT License).
