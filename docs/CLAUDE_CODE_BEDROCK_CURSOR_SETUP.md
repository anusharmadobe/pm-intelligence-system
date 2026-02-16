# Claude Code Extension + AWS Bedrock in Cursor: Complete Setup Guide

> **Last verified:** February 2026, Claude Code extension v2.1.39, Cursor v2.4.31, macOS (darwin arm64)
>
> **Purpose:** Step-by-step instructions to configure the Claude Code VS Code/Cursor extension to authenticate via AWS Bedrock (bearer token) instead of Anthropic's consumer login. Includes all pitfalls discovered during debugging and their exact fixes.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Quick Setup (Do This First Time)](#2-quick-setup-do-this-first-time)
3. [Detailed File-by-File Configuration](#3-detailed-file-by-file-configuration)
4. [Common Errors and Fixes](#4-common-errors-and-fixes)
5. [Architecture: How the Extension Loads Credentials](#5-architecture-how-the-extension-loads-credentials)
6. [Troubleshooting Flowchart](#6-troubleshooting-flowchart)
7. [Nuclear Reset Procedure](#7-nuclear-reset-procedure)
8. [Reference: Environment Variables](#8-reference-environment-variables)

---

## 1. Prerequisites

- **Cursor** (or VS Code) installed
- **Claude Code extension** installed from the marketplace (`Anthropic.claude-code`)
- **Claude CLI** installed at `~/.local/bin/claude` (run `claude --version` to verify)
- **AWS Bedrock bearer token** (starts with `ABSK...`)
- **AWS Region** where your Bedrock models are provisioned (e.g., `us-west-2`)
- **Model IDs** for the Bedrock-provisioned Claude models you want to use

---

## 2. Quick Setup (Do This First Time)

Run these steps in order. Do NOT skip any step.

### Step 1: Configure `~/.claude/settings.json` (Claude Code's own config)

This file **must be valid JSON**. It is NOT a shell script. Do not put `export` statements here.

```bash
mkdir -p ~/.claude
cat > ~/.claude/settings.json << 'ENDJSON'
{
  "permissions": {
    "allow": [],
    "deny": []
  },
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_BEARER_TOKEN_BEDROCK": "<YOUR_BEDROCK_TOKEN>",
    "AWS_REGION": "us-west-2",
    "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION": "us-west-2",
    "ANTHROPIC_MODEL": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "ANTHROPIC_SMALL_FAST_MODEL": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "us.anthropic.claude-opus-4-5-20251101-v1:0",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "CLAUDE_CODE_SUBAGENT_MODEL": "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
  }
}
ENDJSON
```

**Validate it:**
```bash
python3 -c "import json; json.load(open('$HOME/.claude/settings.json')); print('OK')"
```

### Step 2: Configure `~/.zshrc` (for terminal-based Claude CLI)

Add these exports to your shell profile (`~/.zshrc` for macOS):

```bash
# Claude Code + AWS Bedrock
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_BEARER_TOKEN_BEDROCK="<YOUR_BEDROCK_TOKEN>"
export AWS_REGION=us-west-2
export ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION=us-west-2
export ANTHROPIC_MODEL='us.anthropic.claude-sonnet-4-5-20250929-v1:0'
export ANTHROPIC_SMALL_FAST_MODEL='us.anthropic.claude-haiku-4-5-20251001-v1:0'
export ANTHROPIC_DEFAULT_HAIKU_MODEL='us.anthropic.claude-haiku-4-5-20251001-v1:0'
export ANTHROPIC_DEFAULT_OPUS_MODEL='us.anthropic.claude-opus-4-5-20251101-v1:0'
export ANTHROPIC_DEFAULT_SONNET_MODEL='us.anthropic.claude-sonnet-4-5-20250929-v1:0'
export CLAUDE_CODE_SUBAGENT_MODEL='us.anthropic.claude-sonnet-4-5-20250929-v1:0'
```

**Verify it:**
```bash
source ~/.zshrc
echo "ping" | claude --print
# Should get a response from Claude, not a login error
```

### Step 3: Configure Cursor User Settings

Open Cursor settings JSON: `Cmd+Shift+P` > `Preferences: Open User Settings (JSON)`

Add or merge these keys into the JSON object. **Pay very close attention to the data types** -- getting these wrong is the #1 cause of failure.

```jsonc
{
    // Suppress the extension's login prompt (we auth via Bedrock, not OAuth)
    "claudeCode.disableLoginPrompt": true,

    // Use terminal mode -- the native sidebar webview has auth bugs with Bedrock
    "claudeCode.useTerminal": true,

    // Inject Bedrock env vars into the Claude process spawned by the extension.
    // CRITICAL: This MUST be an array of {name, value} objects.
    // NOT an object/map. NOT an array of "KEY=VALUE" strings.
    "claudeCode.environmentVariables": [
        { "name": "CLAUDE_CODE_USE_BEDROCK", "value": "1" },
        { "name": "AWS_BEARER_TOKEN_BEDROCK", "value": "<YOUR_BEDROCK_TOKEN>" },
        { "name": "AWS_REGION", "value": "us-west-2" },
        { "name": "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION", "value": "us-west-2" },
        { "name": "ANTHROPIC_MODEL", "value": "us.anthropic.claude-sonnet-4-5-20250929-v1:0" },
        { "name": "ANTHROPIC_SMALL_FAST_MODEL", "value": "us.anthropic.claude-haiku-4-5-20251001-v1:0" },
        { "name": "ANTHROPIC_DEFAULT_HAIKU_MODEL", "value": "us.anthropic.claude-haiku-4-5-20251001-v1:0" },
        { "name": "ANTHROPIC_DEFAULT_OPUS_MODEL", "value": "us.anthropic.claude-opus-4-5-20251101-v1:0" },
        { "name": "ANTHROPIC_DEFAULT_SONNET_MODEL", "value": "us.anthropic.claude-sonnet-4-5-20250929-v1:0" },
        { "name": "CLAUDE_CODE_SUBAGENT_MODEL", "value": "us.anthropic.claude-sonnet-4-5-20250929-v1:0" }
    ],

    // Also inject into Cursor's integrated terminal (macOS)
    "terminal.integrated.env.osx": {
        "CLAUDE_CODE_USE_BEDROCK": "1",
        "AWS_BEARER_TOKEN_BEDROCK": "<YOUR_BEDROCK_TOKEN>",
        "AWS_REGION": "us-west-2",
        "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION": "us-west-2",
        "ANTHROPIC_MODEL": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "ANTHROPIC_SMALL_FAST_MODEL": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "us.anthropic.claude-opus-4-5-20251101-v1:0",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "CLAUDE_CODE_SUBAGENT_MODEL": "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    }
}
```

### Step 4: Validate and Restart

```bash
# Validate Cursor settings is valid JSON
python3 -c "import json; json.load(open('$HOME/Library/Application Support/Cursor/User/settings.json')); print('OK')"

# Clear any stale Claude lock files
rm -f ~/.claude/ide/*.lock
```

Then: **Fully quit Cursor (Cmd+Q)** and reopen it.

Open Claude Code via `Cmd+Escape` or the command palette: `Claude Code: Open in Terminal`.

---

## 3. Detailed File-by-File Configuration

### File 1: `~/.claude/settings.json`

| Property | Type | Purpose |
|----------|------|---------|
| `permissions.allow` | `string[]` | Tool permissions allow list |
| `permissions.deny` | `string[]` | Tool permissions deny list |
| `env` | `{ [key: string]: string }` | Environment variables injected into every Claude Code session |

**Schema:** Defined in the extension at `<ext>/claude-code-settings.schema.json`. The `env` field is an **object** with string keys and string values.

**Common mistake:** Putting shell `export` statements in this file. It must be pure JSON.

### File 2: `~/.zshrc` (or `~/.bashrc`)

Standard shell exports. These are sourced when you open a terminal. They make `claude` CLI work from any terminal.

**Common mistake:** Not sourcing after editing (`source ~/.zshrc`).

### File 3: Cursor User Settings (`~/Library/Application Support/Cursor/User/settings.json`)

Three critical settings for Bedrock:

| Setting | Type | Purpose |
|---------|------|---------|
| `claudeCode.environmentVariables` | `Array<{ name: string, value: string }>` | Env vars passed to the Claude process the extension spawns |
| `claudeCode.useTerminal` | `boolean` | Use terminal mode instead of native webview sidebar |
| `claudeCode.disableLoginPrompt` | `boolean` | Suppress the OAuth login prompt |
| `terminal.integrated.env.osx` | `{ [key: string]: string }` | Env vars for Cursor's built-in terminal |

**CRITICAL FORMAT NOTE for `claudeCode.environmentVariables`:**

The extension's `package.json` defines this as:
```json
{
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "value": { "type": "string" }
        },
        "required": ["name", "value"]
    }
}
```

These formats are **WRONG** and will crash the extension or silently fail:

```jsonc
// WRONG: object/map format
"claudeCode.environmentVariables": {
    "KEY": "VALUE"
}

// WRONG: string format
"claudeCode.environmentVariables": [
    "KEY=VALUE"
]

// WRONG: shell exports
"claudeCode.environmentVariables": [
    "export KEY=VALUE"
]
```

The **ONLY correct format** is:
```json
"claudeCode.environmentVariables": [
    { "name": "KEY", "value": "VALUE" }
]
```

---

## 4. Common Errors and Fixes

### Error: "Unable to write into user settings"

**Cause:** Cursor's `settings.json` contains invalid JSON (syntax error, wrong types, duplicate keys).

**Fix:**
```bash
# Validate
python3 -c "import json; json.load(open('$HOME/Library/Application Support/Cursor/User/settings.json'))"
# If it throws an error, open the file and fix the JSON syntax
```

### Error: "An error occurred while loading view: claudeVSCodeSidebar"

**Cause (1):** `claudeCode.environmentVariables` is in the wrong format (object instead of array-of-objects). The extension crashes trying to iterate it.

**Cause (2):** Stale webview state in Cursor's SQLite state database.

**Fix for Cause 1:** Correct the format as described above.

**Fix for Cause 2:** Clear Claude-related keys from the state DB:
```bash
sqlite3 "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" \
  "DELETE FROM ItemTable WHERE key IN (
    'Anthropic.claude-code',
    'externalCliAnalytics.lastTimestamp.claude',
    'workbench.view.extension.claude-sidebar.state.hidden',
    'memento/webviewViews.origins',
    'memento/mainThreadWebviewPanel.origins'
  );"
```

Then fully restart Cursor.

### Error: "Not logged in - Please run /login"

**Cause:** The extension's native sidebar webview has a separate auth check (OAuth-based) that doesn't understand Bedrock bearer tokens. Even though the Claude CLI process authenticates successfully via Bedrock, the sidebar UI layer reports "not logged in."

**Fix:** Enable terminal mode, which bypasses the problematic sidebar auth:
```json
{
    "claudeCode.useTerminal": true,
    "claudeCode.disableLoginPrompt": true
}
```

### Error: "The git repository has too many active changes"

**Cause:** Large untracked directories (e.g., `.venv/` with 60K+ files) overwhelm Cursor's git integration, which also causes extensions to malfunction.

**Fix:** Add bulk directories to `.gitignore`:
```gitignore
.venv/
__pycache__/
*.pyc
output/
backup/
node_modules/
dist/
```

### Error: Stale lock file preventing extension startup

**Cause:** A previous Claude Code process crashed, leaving `~/.claude/ide/<pid>.lock` pointing to a dead PID. The extension tries to connect to this dead process.

**Fix:**
```bash
rm -f ~/.claude/ide/*.lock
```

---

## 5. Architecture: How the Extension Loads Credentials

Understanding this flow is key to debugging:

```
Cursor starts
  |
  v
Extension activates (onStartupFinished)
  |
  v
AuthManager initialized
  |-- Checks claudeCode.environmentVariables from Cursor settings
  |-- Merges with process.env (inherited from terminal.integrated.env.osx)
  |
  v
"Getting authentication status" (appears in logs)
  |-- In NATIVE sidebar mode: runs its own OAuth check --> FAILS for Bedrock
  |-- In TERMINAL mode: defers to CLI process auth --> WORKS for Bedrock
  |
  v
Spawns Claude binary at:
  <ext>/resources/native-binary/claude
  |-- Inherits env vars from claudeCode.environmentVariables
  |-- Also reads ~/.claude/settings.json env field
  |-- Also reads process.env (from terminal.integrated.env.osx / shell profile)
  |
  v
Claude binary starts API session
  |-- Detects CLAUDE_CODE_USE_BEDROCK=1
  |-- Uses AWS_BEARER_TOKEN_BEDROCK for auth
  |-- Connects to Bedrock endpoint in AWS_REGION
  |
  v
"Stream started - received first chunk" (success in logs)
```

**Key insight:** The Claude CLI binary supports Bedrock natively. The extension's sidebar webview auth layer does NOT. Terminal mode bridges the gap.

### Where credentials are read from (priority order)

1. `claudeCode.environmentVariables` in Cursor settings (injected into spawned process)
2. `terminal.integrated.env.osx` in Cursor settings (for terminal-mode processes)
3. `env` field in `~/.claude/settings.json` (read by the Claude binary itself)
4. Shell environment (`~/.zshrc` exports, inherited when Cursor is launched from terminal)

All four should be configured for maximum reliability.

---

## 6. Troubleshooting Flowchart

```
Claude Code not working in Cursor?
  |
  |-- Is "echo ping | claude --print" working in a regular terminal?
  |     |
  |     |-- NO --> Fix ~/.zshrc exports and ~/.claude/settings.json
  |     |-- YES --> Continue below
  |
  |-- Is Cursor settings.json valid JSON?
  |     |
  |     |-- NO --> Fix JSON syntax errors
  |     |-- YES --> Continue below
  |
  |-- Is claudeCode.environmentVariables in correct format?
  |     (Must be array of {name, value} objects)
  |     |
  |     |-- NO --> Fix the format
  |     |-- YES --> Continue below
  |
  |-- Is claudeCode.useTerminal set to true?
  |     |
  |     |-- NO --> Set it to true (sidebar auth is broken for Bedrock)
  |     |-- YES --> Continue below
  |
  |-- Are there stale lock files?
  |     (ls ~/.claude/ide/)
  |     |
  |     |-- YES --> rm -f ~/.claude/ide/*.lock
  |     |-- NO --> Continue below
  |
  |-- Is there stale webview state?
  |     |
  |     |-- Try the sqlite3 cleanup command from Section 4
  |     |-- Fully restart Cursor (Cmd+Q, reopen)
  |
  |-- Check extension log:
  |     ~/Library/Application Support/Cursor/logs/<latest>/
  |       window1/exthost/Anthropic.claude-code/Claude VSCode.log
  |
  |     Look for:
  |       - "Fast mode unavailable: ... Bedrock" = Bedrock detected (GOOD)
  |       - "Stream started" = API working (GOOD)
  |       - "OAuth token check" = Auth flow running (normal)
  |       - Any [ERROR] lines = investigate
```

---

## 7. Nuclear Reset Procedure

If nothing else works, this resets all Claude Code state in Cursor while preserving your credentials:

```bash
# 1. Fully quit Cursor (Cmd+Q)

# 2. Clear extension state from Cursor's DB
sqlite3 "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" \
  "DELETE FROM ItemTable WHERE key LIKE '%claude%' OR key LIKE '%Claude%' OR key LIKE '%Anthropic%';"

# 3. Clear Claude IDE lock files
rm -f ~/.claude/ide/*.lock

# 4. Clear Claude session files for the workspace (optional)
rm -f ~/.claude/projects/-Users-*/*.jsonl
rm -f ~/.claude/todos/*.json

# 5. Verify config files are valid
python3 -c "import json; json.load(open('$HOME/.claude/settings.json')); print('claude settings: OK')"
python3 -c "import json; json.load(open('$HOME/Library/Application Support/Cursor/User/settings.json')); print('cursor settings: OK')"

# 6. Verify CLI works
source ~/.zshrc
echo "ping" | claude --print

# 7. Reopen Cursor
```

---

## 8. Reference: Environment Variables

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `CLAUDE_CODE_USE_BEDROCK` | Yes | `1` | Enables Bedrock authentication mode |
| `AWS_BEARER_TOKEN_BEDROCK` | Yes | `ABSK...` | Your AWS Bedrock API key (base64-encoded) |
| `AWS_REGION` | Yes | `us-west-2` | AWS region for Bedrock API calls |
| `ANTHROPIC_MODEL` | No | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Default model for main conversations |
| `ANTHROPIC_SMALL_FAST_MODEL` | No | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Model for quick/cheap operations |
| `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION` | No | `us-west-2` | Region override for the small/fast model |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | No | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Haiku model override |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | No | `us.anthropic.claude-opus-4-5-20251101-v1:0` | Opus model override |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | No | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Sonnet model override |
| `CLAUDE_CODE_SUBAGENT_MODEL` | No | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Model used for subagent/background tasks |

**Note on model IDs:** Bedrock model IDs use the format `us.anthropic.claude-{variant}-{version}:0`. These are different from Anthropic API model IDs (which lack the `us.` prefix and `:0` suffix). Use the Bedrock format when configuring for Bedrock auth.

---

## Appendix: Files Modified During This Setup

| File | What goes here | Format |
|------|---------------|--------|
| `~/.claude/settings.json` | Claude Code config with `env` object | JSON: `{ "env": { "KEY": "VALUE" } }` |
| `~/.zshrc` | Shell exports for terminal CLI | Shell: `export KEY=VALUE` |
| `~/Library/Application Support/Cursor/User/settings.json` | Cursor editor settings | JSON with specific key types (see Section 3) |
| `~/.claude/ide/*.lock` | Runtime lock files (auto-created) | Delete if stale |
| `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | Cursor extension state DB | SQLite; clear Claude keys if stuck |
| `.gitignore` (in your project) | Must exclude `.venv/`, `output/`, etc. | Gitignore syntax |
