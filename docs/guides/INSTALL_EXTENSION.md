# Install PM Intelligence Extension in Cursor IDE

## ✅ VSIX File Created

The extension has been packaged as a VSIX file:
- **Location:** `backup/cursor_extension/cursor_extension/pm-intelligence-system-1.0.0.vsix`
- **Size:** ~15.71 KB
- **Status:** Ready to install

---

## Installation Steps

### Method 1: Install from VSIX File (Recommended)

1. **Open Cursor IDE**

2. **Open Command Palette:**
   - **Mac:** Press `Cmd+Shift+P`
   - **Windows/Linux:** Press `Ctrl+Shift+P`

3. **Install Extension:**
   - Type: `Extensions: Install from VSIX...`
   - Select the file: `/Users/anusharm/learn/PM_cursor_system/backup/cursor_extension/cursor_extension/pm-intelligence-system-1.0.0.vsix`
   - Click "Install"

4. **Reload Cursor:**
   - Press `Cmd+Shift+P` / `Ctrl+Shift+P`
   - Type: `Developer: Reload Window`
   - Press Enter

5. **Verify Installation:**
   - Press `Cmd+Shift+P` / `Ctrl+Shift+P`
   - Type: `PM Intelligence`
   - You should see all commands:
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

### Method 2: Install from Extension Location

If VSIX installation doesn't work:

1. **Open Cursor IDE**

2. **Open Command Palette:**
   - Press `Cmd+Shift+P` / `Ctrl+Shift+P`

3. **Install from Location:**
   - Type: `Developer: Install Extension from Location...`
   - Navigate to: `/Users/anusharm/learn/PM_cursor_system/backup/cursor_extension/cursor_extension`
   - Select the folder

4. **Reload Cursor:**
   - `Developer: Reload Window`

---

## Using "PM Intelligence: Create Judgment"

After installation:

1. **Ensure API Server is Running:**
   ```bash
   npm start
   # Or: npm run dev
   ```

2. **Ensure Opportunities Exist:**
   ```bash
   curl -X POST http://localhost:3000/api/opportunities/detect/incremental
   ```

3. **Open Command Palette:**
   - `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)

4. **Run Command:**
   - Type: `PM Intelligence: Create Judgment`
   - Select an opportunity
   - Enter your user ID
   - Wait for LLM processing
   - Review the judgment

---

## Troubleshooting

### Extension Not Appearing After Installation

1. **Check Extension is Loaded:**
   - Command Palette → `Developer: Show Running Extensions`
   - Look for "PM Intelligence System"

2. **Check for Errors:**
   - Open Output panel (`View → Output`)
   - Select "PM Intelligence System" from dropdown
   - Check for error messages

3. **Try Reloading:**
   - `Developer: Reload Window`

### Commands Still Not Appearing

1. **Verify Extension Files:**
   ```bash
   ls -la backup/cursor_extension/cursor_extension/*.js
   ```
   Should show: `extension.js`, `mcp_helper.js`, `slack_mcp_commands.js`

2. **Check package.json:**
   ```bash
   cat backup/cursor_extension/cursor_extension/package.json | grep -A 5 "main"
   ```
   Should show: `"main": "./extension.js"`

3. **Recompile if Needed:**
   ```bash
   cd backup/cursor_extension/cursor_extension
   npx tsc extension.ts slack_mcp_commands.ts mcp_helper.ts --module commonjs --target ES2020 --lib ES2020 --moduleResolution node --esModuleInterop --skipLibCheck
   ```

### "LLM API not available" Error

- Must be running in **Cursor IDE** (not VS Code)
- Cursor version must support `vscode.lm` API
- Try reloading Cursor window

---

## Alternative: Use Scripts (No Extension Needed)

If extension installation doesn't work, you can use scripts instead:

```bash
# Detect opportunities
curl -X POST http://localhost:3000/api/opportunities/detect/incremental

# View opportunities
curl http://localhost:3000/api/opportunities

# View judgments (after creating via extension)
curl http://localhost:3000/api/judgments/{opportunity_id}
```

**Note:** Judgment creation requires the extension (needs Cursor's LLM API), but all other functionality works via API/scripts.

---

## Files Created

- ✅ `backup/cursor_extension/cursor_extension/pm-intelligence-system-1.0.0.vsix` - Extension package
- ✅ `backup/cursor_extension/cursor_extension/extension.js` - Compiled extension code
- ✅ `backup/cursor_extension/cursor_extension/slack_mcp_commands.js` - Slack MCP commands
- ✅ `backup/cursor_extension/cursor_extension/mcp_helper.js` - MCP helper utilities

---

## Next Steps

1. Install the VSIX file in Cursor IDE
2. Reload Cursor window
3. Verify commands appear
4. Use "PM Intelligence: Create Judgment" to analyze opportunities!
