# Fix: "command 'pm-intelligence.createJudgment' not found"

## Problem
The extension command is not found, which means the extension is either:
1. Not installed
2. Not activated
3. Not properly registered

## Solution Steps

### Step 1: Install the Extension from VSIX

1. **Open Cursor IDE**
2. **Press `Cmd+Shift+P`** (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. **Type**: `Extensions: Install from VSIX...`
4. **Select the file**: `/Users/anusharm/learn/PM_cursor_system/backup/cursor_extension/cursor_extension/pm-intelligence-system-1.0.0.vsix`
5. **Reload Cursor**: Press `Cmd+Shift+P` → Type `Developer: Reload Window`

### Step 2: Verify Extension is Installed

1. Press `Cmd+Shift+P`
2. Type `Extensions: Show Installed Extensions`
3. Look for "PM Intelligence System" in the list
4. If it's disabled, click "Enable"

### Step 3: Check Extension Activation

The extension should activate automatically when you:
- Open the workspace
- Run any PM Intelligence command

If it doesn't activate, check the Developer Console:
1. Press `Cmd+Shift+P`
2. Type `Developer: Toggle Developer Tools`
3. Look for console errors or "PM Intelligence Extension Active" message

### Step 4: Test the Command

1. Press `Cmd+Shift+P`
2. Type `PM Intelligence: Create Judgment`
3. The command should appear and be executable

## Alternative: Development Mode Installation

If VSIX installation doesn't work, try development mode:

1. **Open Terminal in Cursor**
2. **Navigate to extension directory**:
   ```bash
  cd /Users/anusharm/learn/PM_cursor_system/backup/cursor_extension/cursor_extension
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Compile TypeScript**:
   ```bash
   npx tsc extension.ts slack_mcp_commands.ts --module commonjs --target ES2020 --lib ES2020 --moduleResolution node --esModuleInterop --skipLibCheck --resolveJsonModule
   ```

5. **Press `F5`** in Cursor IDE to launch Extension Development Host
   - This opens a new Cursor window with the extension loaded
   - Test commands in that window

## Changes Made

1. **Activation Events**: Changed from specific command activation to `"*"` (activate on startup)
2. **Activation Message**: Added a notification when extension activates
3. **VSIX Rebuilt**: Created new VSIX package with updated activation

## Still Not Working?

If the command still doesn't appear:

1. **Check Cursor version**: Ensure Cursor IDE version is >= 1.80.0
2. **Check for conflicts**: Disable other extensions temporarily
3. **Check logs**: View Output panel → Select "Log (Extension Host)"
4. **Manual registration**: The extension may need to be loaded differently in Cursor vs VS Code

## Quick Test Script

Run this to verify backend is working (extension-independent):

```bash
cd /Users/anusharm/learn/PM_cursor_system
npm run test-all-extension-functions
```

This tests all backend APIs the extension uses.
