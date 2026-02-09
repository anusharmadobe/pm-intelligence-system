# Quick Start: Create Judgment in Cursor IDE

## 🚀 Simple Steps

### 1. Open Command Palette
- **Mac:** `Cmd+Shift+P`
- **Windows/Linux:** `Ctrl+Shift+P`

### 2. Type Command Name
Type: `PM Intelligence: Create Judgment`

### 3. Select an Opportunity
- A list of opportunities will appear
- Select the one you want to analyze
- Example: "NFCU & IRS - Feature Request - nfcu (118 signals)"

### 4. Enter Your User ID
- Enter any identifier (e.g., `your-name` or `user@example.com`)
- This is required for human-in-the-loop tracking

### 5. Wait for Processing
- Cursor's LLM will analyze the opportunity
- This takes 10-30 seconds depending on signal count

### 6. Review Results
- You'll see: `Judgment created: [id] (confidence: [level])`
- The judgment is now saved in the database

---

## ⚠️ If Command Doesn't Appear

### Option 1: Build and Install Extension

```bash
# Navigate to extension directory
cd backup/cursor_extension/cursor_extension

# Install dependencies (if needed)
npm install

# Compile TypeScript to JavaScript
npx tsc extension.ts

# This creates extension.js
```

Then in Cursor IDE:
1. Press `Cmd+Shift+P` / `Ctrl+Shift+P`
2. Type: `Developer: Install Extension from Location`
3. Select the `backup/cursor_extension/cursor_extension` folder
4. Reload Cursor: `Developer: Reload Window`

### Option 2: Check if Extension is Loaded

1. Press `Cmd+Shift+P` / `Ctrl+Shift+P`
2. Type: `Developer: Show Running Extensions`
3. Look for "PM Intelligence System"

### Option 3: Verify Prerequisites

**Check API Server:**
```bash
curl http://localhost:3000/health
```

**Check Opportunities Exist:**
```bash
curl http://localhost:3000/api/opportunities | jq '.opportunities | length'
```

**If no opportunities:**
```bash
curl -X POST http://localhost:3000/api/opportunities/detect/incremental
```

---

## 📋 What You'll See

### Step 1: Opportunity Selection
```
Select an opportunity to create judgment for
┌─────────────────────────────────────────────┐
│ NFCU & IRS - Feature Request - nfcu (118)   │
│ SPA & FPR - Forms - forms (160 signals)    │
│ confirmed & Adobe - Core Components (107)   │
│ ...                                         │
└─────────────────────────────────────────────┘
```

### Step 2: User ID Prompt
```
Your user ID (required for human-in-the-loop)
┌─────────────────────────────────────────────┐
│ user@example.com                            │
└─────────────────────────────────────────────┘
```

### Step 3: Processing
- Shows "Processing..." or spinner
- LLM analyzes signals
- Generates judgment

### Step 4: Success Message
```
✅ Judgment created: abc-123-def (confidence: high)
```

---

## 🔍 View Created Judgments

**Via API:**
```bash
# Get opportunity ID first
curl http://localhost:3000/api/opportunities | jq '.opportunities[0].id'

# View judgments for that opportunity
curl http://localhost:3000/api/judgments/{opportunity_id}
```

**Via Extension:**
- Command: `PM Intelligence: View Opportunities`
- Select opportunity
- View associated judgments

---

## 💡 Tips

1. **Start with High-Signal Opportunities**
   - Focus on opportunities with 50+ signals
   - These have more data for better analysis

2. **Top Opportunities to Try:**
   - "SPA & FPR - Forms - forms (160 signals)"
   - "NFCU & IRS - Feature Request - nfcu (118 signals)"
   - "confirmed & Adobe - Core Components (107 signals)"

3. **Review Multiple Judgments**
   - Create judgments for different opportunities
   - Compare patterns and insights

4. **Check Missing Evidence**
   - Use the "missing evidence" list
   - Guide further data collection

---

## 🐛 Troubleshooting

### "Command not found"
- Extension not installed → Build and install (see Option 1 above)
- Extension not loaded → Reload Cursor window
- Wrong workspace → Open the PM_cursor_system folder in Cursor

### "No opportunities found"
- Run detection: `curl -X POST http://localhost:3000/api/opportunities/detect/incremental`
- Check API: `curl http://localhost:3000/api/opportunities`

### "LLM API not available"
- Must be running in Cursor IDE (not VS Code)
- Cursor version must support `vscode.lm` API
- Try reloading Cursor window

### "Failed to create judgment"
- Check API server is running: `curl http://localhost:3000/health`
- Check opportunity exists: `curl http://localhost:3000/api/opportunities`
- Check error message for specific issue

---

## 📚 Full Documentation

See `HOW_TO_USE_CREATE_JUDGMENT.md` for detailed documentation.

---

## ✅ Quick Checklist

- [ ] API server running (`npm start`)
- [ ] Opportunities detected (46 opportunities available)
- [ ] Cursor IDE open (not VS Code)
- [ ] Extension compiled (if needed)
- [ ] Command Palette ready (`Cmd+Shift+P` / `Ctrl+Shift+P`)

**Ready to go!** 🎉
