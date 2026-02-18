#!/bin/bash

# Quick session state saver (fallback when MCP not available)
# Usage: ./.claude/save-session.sh "What I'm working on" "What I completed" "What's next"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
STATE_FILE=".claude/session_state.json"

# Get git status for context
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
GIT_STATUS=$(git status --short 2>/dev/null || echo "")
MODIFIED_FILES=$(git diff --name-only 2>/dev/null | tr '\n' ',' || echo "")

# Create JSON state
cat > "$STATE_FILE" <<EOF
{
  "current_task": "${1:-Working on logging implementation}",
  "completed_steps": [
    "${2:-Enhanced logger, added logging to services}"
  ],
  "next_steps": [
    "${3:-Test pipeline, verify logs}"
  ],
  "important_notes": "",
  "files_modified": ["$MODIFIED_FILES"],
  "active_plan_file": "",
  "git_branch": "$GIT_BRANCH",
  "git_status": "$GIT_STATUS",
  "saved_at": "$TIMESTAMP",
  "saved_via": "shell_script"
}
EOF

echo "✅ Session state saved to $STATE_FILE"
echo "📝 Current task: ${1:-Working on logging implementation}"
echo "🌿 Git branch: $GIT_BRANCH"
echo "⏰ Saved at: $TIMESTAMP"
echo ""
echo "To restore: cat .claude/session_state.json"
