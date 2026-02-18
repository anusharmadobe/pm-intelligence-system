# Session Continuity Commands

## 🔴 Before Closing Cursor

Run these commands in your Claude Code chat to save your session state:

### Option 1: Using MCP Tool (Recommended if MCP server is running)

```
Use the save_session_state tool with:
- current_task: "Brief description of what I'm working on"
- completed_steps: ["Step 1", "Step 2", "Step 3"]
- next_steps: ["Next thing to do", "Then this", "Finally this"]
- important_notes: "Any critical context, decisions, or blockers"
- files_modified: ["file1.ts", "file2.ts"]
- active_plan_file: "~/.claude/plans/staged-squishing-honey.md"
```

**Example:**
```
Save session state:
- Current task: Testing logging system with post-ingestion pipeline
- Completed: Enhanced logger.ts, added logging to 14 services, configured .env
- Next steps: Run pipeline, verify logs, test session state tools
- Important notes: LOG_LEVEL=info, LOG_LEVEL_OPPORTUNITY=debug configured
- Files: logger.ts, opportunity_service.ts, jira_issue_service.ts, export_data.ts
```

### Option 2: Manual Update (If MCP not running)

```
Update .claude/current-work.md with current status, completed steps, and next steps
```

### Option 3: Quick Terminal Command

```bash
cd /Users/anusharm/learn/PM_cursor_system
echo "Session closed at $(date)" >> .claude/session_state.txt
```

---

## 🟢 After Starting Cursor

Run these commands in your new Claude Code session to resume:

### Step 1: Load Session State

```
Read .claude/current-work.md to continue from where I left off
```

### Step 2: Load MCP Session State (If saved via MCP)

```
Use the load_session_state tool to load the previous session
```

### Step 3: Verify Context

```
Summarize what I was working on and what needs to be done next
```

---

## 📋 Complete Workflow Example

### Before Closing:
1. In Claude Code chat:
   ```
   Save my session state with these details:
   - Task: Testing comprehensive logging system
   - Completed: Added logging to 14 services, fixed 6 bugs, configured .env
   - Next: Run post-ingestion pipeline and verify logs
   - Notes: LOG_LEVEL=info, LOG_LEVEL_OPPORTUNITY=debug
   ```

2. Wait for confirmation: `✅ Session state saved`

3. Close Cursor

### After Reopening:
1. In new Claude Code chat:
   ```
   Load my previous session state and tell me what I was working on
   ```

2. Claude will respond with your saved state

3. Continue work:
   ```
   Let's continue with the next steps from my previous session
   ```

---

## 🛠️ Advanced: Using MCP Server Directly

### Start MCP Server:
```bash
cd /Users/anusharm/learn/PM_cursor_system/backend
npm run mcp
```

### Configure Claude Code to Use MCP:

Edit `~/.claude/config.json`:
```json
{
  "mcpServers": {
    "pm-intelligence": {
      "command": "node",
      "args": [
        "/Users/anusharm/learn/PM_cursor_system/backend/dist/mcp/server.js"
      ],
      "env": {
        "NODE_ENV": "development"
      }
    }
  }
}
```

### Restart VSCode/Cursor

The MCP tools will be available in Claude Code sessions.

---

## 💡 Pro Tips

### 1. Keep Multiple Work Files
```
.claude/
├── current-work.md       # Main work tracker
├── decisions.md          # Architectural decisions
├── bugs.md              # Known issues
└── session_state.json   # Auto-saved by MCP tool
```

### 2. Git Track Your .claude/ Folder
```bash
git add .claude/current-work.md
git commit -m "docs: update work status"
```

This way your session state is version controlled!

### 3. Use Git Commit Messages as Session Markers
```bash
# Before closing
git add -A
git commit -m "wip: comprehensive logging implementation - next: test pipeline"
```

Your git log becomes your session history!

### 4. Set VSCode Auto-Save
In VSCode settings:
```json
{
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000
}
```

So `.claude/current-work.md` is always saved.

---

## 🔍 Quick Status Check

Anytime you want to see where you are:

```
Read .claude/current-work.md and summarize:
1. What am I working on?
2. What's completed?
3. What's next?
```

---

## 📞 Emergency Recovery

If you forget to save before closing:

1. **Check git history:**
   ```bash
   git log --oneline -10
   git diff HEAD~1
   ```

2. **Check Claude Code transcripts:**
   ```bash
   ls -lt ~/.claude/projects/-Users-anusharm-learn-PM-cursor-system/
   # Read the latest .jsonl file
   ```

3. **Check log files:**
   ```bash
   tail -100 logs/combined.log
   ```

4. **Ask Claude:**
   ```
   Based on recent git commits and file timestamps, what was I likely working on?
   ```
