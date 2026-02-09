# How to Check Extension Activation Logs

## The extension is still stuck in "activating" mode

To diagnose the issue, check the Extension Host logs:

### Step 1: Open Extension Host Logs

1. **Open Output Panel**:
   - `View` → `Output` (or `Cmd+Shift+U` on Mac)

2. **Select Log Source**:
   - In the dropdown at the top right of the Output panel
   - Select **"Log (Extension Host)"**

### Step 2: Look for These Messages

**If activation succeeds**, you should see:
```
PM Intelligence Extension Activating...
PM Intelligence Extension Active
Slack MCP commands registered successfully
PM Intelligence Extension Fully Activated
```

**If activation fails**, you'll see:
```
CRITICAL: Extension activation failed: [error message]
Activation error stack: [stack trace]
```

**If Slack MCP fails** (non-critical):
```
Failed to register Slack MCP commands (non-critical): [error]
```

### Step 3: Check Developer Console

1. **Open Developer Tools**:
   - `Cmd+Shift+P` → `Developer: Toggle Developer Tools`

2. **Check Console Tab**:
   - Look for errors related to:
     - `api_client`
     - `slack_mcp_commands`
     - `PM Intelligence`
     - Import errors

### Step 4: Common Errors to Look For

1. **"Cannot find module './api_client'"**
   - **Fix**: Recompile TypeScript files

2. **"registerSlackMCPCommands is not a function"**
   - **Fix**: Check `slack_mcp_commands.ts` exports correctly

3. **"Cannot find module '../backend/..."**
   - **Fix**: Old VSIX still installed, reinstall new one

4. **Import errors at top level**
   - **Fix**: Check all imports in `extension.ts`, `api_client.ts`, `slack_mcp_commands.ts`

## What to Share

If still stuck, share:
1. **Extension Host log output** (from Step 1)
2. **Console errors** (from Step 3)
3. **Status from "Show Running Extensions"** (should show error details)

This will help identify the exact issue blocking activation.
