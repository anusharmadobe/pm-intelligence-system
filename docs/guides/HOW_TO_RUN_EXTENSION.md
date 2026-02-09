# How to Run the PM Intelligence Extension Properly

## Prerequisites

1. **Backend Server Must Be Running**
   ```bash
   cd /Users/anusharm/learn/PM_cursor_system
   npm start
   ```
   Verify: `curl http://localhost:3000/health` should return `{"status":"ok"}`

2. **Cursor IDE** (not VS Code - Cursor has the LLM API)

---

## Method 1: Install from VSIX (Recommended)

### Step 1: Verify VSIX File Exists
```bash
ls -lh backup/cursor_extension/cursor_extension/pm-intelligence-system-1.0.0.vsix
```
Should show: `pm-intelligence-system-1.0.0.vsix` (~22 KB)

### Step 2: Install in Cursor IDE
1. **Open Cursor IDE**
2. **Press `Cmd+Shift+P`** (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. **Type**: `Extensions: Install from VSIX...`
4. **Navigate to**: `/Users/anusharm/learn/PM_cursor_system/backup/cursor_extension/cursor_extension/pm-intelligence-system-1.0.0.vsix`
5. **Select the file** and click "Install"

### Step 3: Reload Cursor
1. **Press `Cmd+Shift+P`**
2. **Type**: `Developer: Reload Window`
3. **Press Enter**

### Step 4: Verify Extension is Loaded
1. **Press `Cmd+Shift+P`**
2. **Type**: `Developer: Show Running Extensions`
3. **Look for**: "PM Intelligence System" in the list
4. **Check**: It should show as "Active" or "Activated"

### Step 5: Test Commands
1. **Press `Cmd+Shift+P`**
2. **Type**: `PM Intelligence`
3. **You should see**:
   - PM Intelligence: Create Judgment
   - PM Intelligence: Create Artifact
   - PM Intelligence: Detect Opportunities
   - PM Intelligence: View Opportunities
   - PM Intelligence: View Signals
   - PM Intelligence: View Adoption Metrics
   - PM Intelligence: Ingest Signal
   - PM Intelligence: Ingest Slack Channel (MCP)
   - PM Intelligence: List Slack Channels (MCP)

---

## Method 2: Development Mode (For Debugging)

If VSIX installation doesn't work, try development mode:

### Step 1: Open Extension Folder in Cursor
```bash
cd /Users/anusharm/learn/PM_cursor_system/backup/cursor_extension/cursor_extension
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Compile TypeScript
```bash
npx tsc extension.ts api_client.ts slack_mcp_commands.ts --module commonjs --target ES2020 --lib ES2020 --moduleResolution node --esModuleInterop --skipLibCheck --resolveJsonModule
```

### Step 4: Launch Extension Development Host
1. **Open** `backup/cursor_extension/cursor_extension/package.json` in Cursor
2. **Press `F5`** (or `Cmd+F5` on Mac)
3. **This opens** a new Cursor window with the extension loaded
4. **Test commands** in that new window

---

## Troubleshooting

### Issue: "command 'pm-intelligence.createJudgment' not found"

**Possible Causes:**

1. **Extension Not Installed**
   - Check: `Cmd+Shift+P` → `Extensions: Show Installed Extensions`
   - Look for "PM Intelligence System"
   - If missing, install VSIX (Method 1)

2. **Extension Not Activated**
   - Check: `Cmd+Shift+P` → `Developer: Show Running Extensions`
   - If disabled, click "Enable"
   - Check activation events in `package.json` (should be `"*"`)

3. **Extension Failed to Load**
   - Check: `View` → `Output` → Select "PM Intelligence System" from dropdown
   - Look for error messages
   - Check: `Cmd+Shift+P` → `Developer: Toggle Developer Tools` → Console tab
   - Look for errors starting with "PM Intelligence"

4. **Backend Not Running**
   - Verify: `curl http://localhost:3000/health`
   - Start: `npm start` in project root

5. **Wrong IDE**
   - Must use **Cursor IDE** (not VS Code)
   - Cursor has the `vscode.lm` API for LLM access

### Issue: Extension Installed But Commands Don't Appear

**Fix Steps:**

1. **Check Extension Status**
   ```bash
   # In Cursor: Cmd+Shift+P → "Developer: Show Running Extensions"
   ```

2. **Check for Errors**
   ```bash
   # In Cursor: View → Output → Select "PM Intelligence System"
   ```

3. **Verify package.json**
   ```bash
   cat backup/cursor_extension/cursor_extension/package.json | grep -A 10 "contributes"
   ```
   Should show all commands listed

4. **Reinstall Extension**
   - Uninstall: `Cmd+Shift+P` → `Extensions: Uninstall Extension` → "PM Intelligence System"
   - Reinstall: Follow Method 1 again

5. **Check Cursor Version**
   - Cursor must be version >= 1.80.0
   - Check: `Cursor` → `About Cursor`

### Issue: "LLM API not available"

**Fix:**
- Must be running in **Cursor IDE** (not VS Code)
- Cursor version must support `vscode.lm` API
- Try reloading Cursor window

### Issue: Extension Loads But Commands Fail

**Check:**
1. **Backend is running**: `curl http://localhost:3000/health`
2. **API endpoints work**: `curl http://localhost:3000/api/opportunities`
3. **Check extension logs**: `View` → `Output` → "PM Intelligence System"
4. **Check browser console**: `Cmd+Shift+P` → `Developer: Toggle Developer Tools`

---

## Verification Checklist

- [ ] Backend server is running (`npm start`)
- [ ] Backend health check passes (`curl http://localhost:3000/health`)
- [ ] VSIX file exists (`backup/cursor_extension/cursor_extension/pm-intelligence-system-1.0.0.vsix`)
- [ ] Extension is installed in Cursor IDE
- [ ] Extension shows as "Active" in running extensions
- [ ] Commands appear when typing "PM Intelligence" in command palette
- [ ] No errors in extension output panel
- [ ] No errors in developer console

---

## Quick Test

Once extension is installed:

1. **Ensure backend is running**: `npm start`
2. **Open Cursor IDE**
3. **Press `Cmd+Shift+P`**
4. **Type**: `PM Intelligence: View Opportunities`
5. **Should open** a document showing opportunities

If this works, the extension is properly installed!

---

## Still Not Working?

1. **Check Extension Logs**:
   - `View` → `Output` → Select "PM Intelligence System"
   - Look for "PM Intelligence Extension Active" message
   - Check for any errors

2. **Check Developer Console**:
   - `Cmd+Shift+P` → `Developer: Toggle Developer Tools`
   - Console tab → Look for errors

3. **Verify Files**:
   ```bash
   ls -la backup/cursor_extension/cursor_extension/*.js
   ```
   Should show: `extension.js`, `api_client.js`, `slack_mcp_commands.js`

4. **Recompile if Needed**:
   ```bash
   cd backup/cursor_extension/cursor_extension
   npx tsc extension.ts api_client.ts slack_mcp_commands.ts --module commonjs --target ES2020 --lib ES2020 --moduleResolution node --esModuleInterop --skipLibCheck --resolveJsonModule
   ```

5. **Rebuild VSIX**:
   ```bash
   cd backup/cursor_extension/cursor_extension
   npx vsce package --allow-missing-repository
   ```

---

## Expected Behavior

When properly installed:
- ✅ Extension activates on Cursor startup
- ✅ All commands appear in command palette
- ✅ Commands execute successfully
- ✅ Backend API calls work
- ✅ LLM integration works (for judgment/artifact creation)

---

## Next Steps After Installation

1. **Test Basic Command**: `PM Intelligence: View Opportunities`
2. **Test Judgment Creation**: `PM Intelligence: Create Judgment`
3. **Verify LLM Works**: Judgment should use Cursor's LLM
4. **Check Output**: Judgments should have structured analysis
