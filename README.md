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

That's it. Start a **new** Claude Code session and your Discord profile will show what you're working on.

`setup` writes hooks and a statusline into `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`). Sessions that are already running do not pick them up until they restart.

## What It Shows

| Field | Example |
|-------|---------|
| **Project** | `Working on my-app (main)` |
| **Model** | `Opus 5 (1M context)`, `Sonnet 5`, `Haiku 4.5` |
| **Tokens** | `29.5k tokens` |
| **Cost** | `$0.70` (or `~$0.70` when estimated - see [Cost](#cost)) |
| **Elapsed** | `01:23:45 elapsed` |
| **Activity** | `Editing app.tsx`, `Running terminal command`, `Searching codebase` |
| **Status icon** | Coding / Thinking / Idle |
| **Multi-session** | `[3 sessions]` with aggregated totals |

The model line is Claude Code's own display name, so it tracks whatever you have selected - including context-tier variants like `Opus 5 (1M context)`.

### Activity Detection

| Tool Claude used | Discord shows |
|---------------------|---------------|
| `Write`, `Edit`, `NotebookEdit` | `Editing filename.ts` |
| `Read` | `Reading filename.ts` |
| `Bash` | `Running terminal command` |
| `Grep` | `Searching codebase` |
| `Glob` | `Finding files` |
| `WebSearch` | `Searching the web` |
| `WebFetch` | `Fetching web content` |
| `Agent` | `Running subagent` |
| `Skill` | `Using a skill` |
| Anything else | `Using <ToolName>` |
| Turn finished, or 2 min of silence | `Waiting for input` |

### Multi-Session Support

Running multiple Claude Code instances? The presence automatically:
- Shows the count: `Working on my-app (main) [3 sessions]`
- Aggregates total tokens and cost across all sessions
- Displays the most recently active session's details
- Shows per-session token breakdown on hover

## Cost

Claude Code reports the session's actual cost in the statusline payload, and that number is used whenever it is present. Only when it is missing does claude-presence estimate the cost from token counts and the pricing table below - an estimate is prefixed with `~` on Discord and labelled `(estimated from tokens)` in `claude-presence status`.

Claude API list pricing, USD per million tokens ([source](https://platform.claude.com/docs/en/about-claude/pricing), checked 2026-09-01):

| Model | Model ID | Input | Output |
|-------|----------|-------|--------|
| Claude Fable 5.1 | `claude-fable-5-1` | $10.00 | $50.00 |
| Claude Fable 5 | `claude-fable-5` | $10.00 | $50.00 |
| Claude Opus 5 | `claude-opus-5` | $5.00 | $25.00 |
| Claude Opus 4.8 | `claude-opus-4-8` | $5.00 | $25.00 |
| Claude Opus 4.7 | `claude-opus-4-7` | $5.00 | $25.00 |
| Claude Opus 4.6 | `claude-opus-4-6` | $5.00 | $25.00 |
| Claude Opus 4.5 | `claude-opus-4-5` | $5.00 | $25.00 |
| Claude Sonnet 5 | `claude-sonnet-5` | $2.00 | $10.00 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3.00 | $15.00 |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | $3.00 | $15.00 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 |

Deprecated models still served on Bedrock and Google Cloud are also in the table (Opus 4.1 and Opus 4 at $15/$75, Sonnet 4 at $3/$15), as are `claude-mythos-5-1` and `claude-mythos-5`, which price the same as their Fable counterparts. An unrecognised model id falls back to Opus-tier pricing, since an unknown id is usually a model newer than this table.

Notes on how the estimate is derived:

- **Model ids are normalised before lookup.** Claude Code reports ids like `claude-opus-5[1m]`; the context-tier suffix is stripped, and dated snapshots (`claude-haiku-4-5-20251001`) and platform prefixes (`anthropic.claude-opus-5`) resolve to the right entry.
- **The 1M-token context window is billed at standard rates.** There is no long-context premium to model.
- **Prompt caching is not modelled.** The statusline reports only total input and output tokens, with no cache breakdown. Cache reads bill at 0.1x the input rate (0.025x on Fable 5.1), so a real session with a warm cache costs meaningfully less than the estimate. Treat an estimate as an upper bound.
- **Fast mode is not modelled.** `/fast` bills Opus 5 and Opus 4.8 at $10/$50, and the statusline does not report the speed setting - so an estimate for a fast-mode session is low. Claude Code's own reported cost, which is used whenever available, has this right.

## Commands

| Command | Description |
|---------|-------------|
| `claude-presence setup` | Install or repoint hooks in Claude Code settings |
| `claude-presence uninstall` | Remove everything and restore original settings |
| `claude-presence status` | Show hook status, active sessions, diagnostics |
| `claude-presence --version` | Show version |
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

Hook commands embed the absolute path of the installed package, which is why `setup` repoints existing entries instead of skipping them - see [Updating](#updating).

## Features

- **Zero config** - works immediately after `npm install -g` and `setup`
- **Pre-configured Discord app** - no bot creation needed
- **Non-destructive** - your own hooks in the same events are left untouched
- **StatusLine chaining** - preserves your existing statusline
- **Multi-session aggregation** - tracks all concurrent instances
- **Cost from Claude Code**, with a token-based estimate as fallback
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

This overrides the built-in default. The daemon reads it at session start, so open a new Claude Code session after setting it.

## Updating

```bash
npm install -g github:backyarddd/claude-presence
claude-presence setup
```

Run `setup` after every update. Hook commands contain the absolute path of the installed package, and `setup` rewrites any existing claude-presence hook to point at the current install - so a reinstall, a changed npm prefix, or a Node version switch is repaired by re-running it. Your own hooks in the same events are never touched.

## Uninstall

```bash
claude-presence uninstall   # remove hooks first, while the CLI still exists
npm uninstall -g claude-presence
```

Restores your original Claude Code settings exactly as they were. Only claude-presence's own hooks are removed - hooks of yours that share an event, or even the same hook entry, are left in place. Run `uninstall` **before** removing the package - the hook paths point at the installed files, so uninstalling the package first leaves dead hooks in `settings.json`.

## Development

```bash
npm test    # node:test suite covering pricing resolution and settings.json rewriting
```

## Troubleshooting

**Presence not showing:**
- Discord desktop app must be running (not browser)
- Run `claude-presence status` to check hooks are installed
- Start a **new** Claude Code session (the daemon spawns on session start)
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
- An older copy linked with `npm link` can shadow the global install. Check with `which -a claude-presence` (`where claude-presence` on Windows) and remove the stale one.

**Hooks broke after switching Node versions (nvm, fnm, volta):**
Each Node version has its own global folder, so the installed package moved. Reinstall on the new version and re-run `setup` - it repoints the hooks:
```bash
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
