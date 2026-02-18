# .claude/ Directory

This directory contains Claude Code session tracking and continuity tools.

## Files

### `current-work.md`
- **Purpose:** Main work tracker for session continuity
- **Usage:** Read this at the start of each Claude Code session to resume work
- **Update:** Manually or via MCP `save_session_state` tool
- **Git:** ✅ Commit this file to track progress

### `session_state.json`
- **Purpose:** Auto-generated session state by MCP tool
- **Usage:** Created by `save_session_state`, read by `load_session_state`
- **Update:** Automatically via MCP tools
- **Git:** ❌ Add to .gitignore (contains session-specific data)

### `session-commands.md`
- **Purpose:** Quick reference for session continuity commands
- **Usage:** Reference guide for before/after Cursor restart
- **Update:** Update when commands change
- **Git:** ✅ Commit this file

### `README.md` (this file)
- **Purpose:** Documentation for this directory
- **Git:** ✅ Commit this file

## Quick Start

### Before Closing Cursor:
```
Save session state: working on [task], completed [steps], next [steps]
```

### After Starting Cursor:
```
Read .claude/current-work.md to continue from where I left off
```

## See Also
- [Session Commands Reference](./session-commands.md) - Detailed commands
- [Current Work Tracker](./current-work.md) - Active work status
