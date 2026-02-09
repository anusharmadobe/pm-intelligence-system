#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RAW_DIR="$ROOT/data/raw"
SLACK_RAW_DIR="$RAW_DIR/slack/C04D195JVGS"
INTERMEDIATE_DIR="$ROOT/data/intermediate"
DOCS_DIR="$ROOT/docs"
DOCS_ANALYSIS_DIR="$DOCS_DIR/analysis"
DOCS_GUIDES_DIR="$DOCS_DIR/guides"
DOCS_REPORTS_DIR="$DOCS_DIR/reports"
DOCS_TESTS_DIR="$DOCS_DIR/tests"
DOCS_EXTENSION_DIR="$DOCS_DIR/extension"
BACKUP_DIR="$ROOT/backup/backup_$(date +%Y%m%d_%H%M%S)"
EXTENSION_ARCHIVE_DIR="$ROOT/backup/cursor_extension"

mkdir -p "$RAW_DIR" "$SLACK_RAW_DIR" "$INTERMEDIATE_DIR" "$DOCS_DIR"
mkdir -p "$DOCS_ANALYSIS_DIR" "$DOCS_GUIDES_DIR" "$DOCS_REPORTS_DIR" "$DOCS_TESTS_DIR" "$DOCS_EXTENSION_DIR"
mkdir -p "$BACKUP_DIR/docs" "$BACKUP_DIR/logs" "$BACKUP_DIR/node_modules" "$BACKUP_DIR/misc"
mkdir -p "$EXTENSION_ARCHIVE_DIR"

echo "Reorg root: $ROOT"
echo "Backup folder: $BACKUP_DIR"

# Move docs (keep README at root)
for f in *.md; do
  [ -e "$f" ] || continue
  if [ "$f" = "README.md" ]; then
    continue
  fi
  case "$f" in
    ANALYSIS_*|GENAI_*|FINAL_SUMMARY.md|SLACK_ONLY_ARCHITECTURE.md|PM_COMPONENT_MAPPING_REPORT.md)
      mv "$f" "$DOCS_ANALYSIS_DIR/"
      ;;
    QUICK_START*|START_HERE.md|HOW_TO_*|SETUP_*|INSTALL_*|RUN_*|EXECUTE_IN_CURSOR.md|API.md|USER_GUIDE.md|CURSOR_EXTENSION_INSTRUCTIONS.md|MCP_*|SLACK_*|FETCH_AND_INGEST_THREADS.md|IMPORTANT_RUN_IN_CURSOR_IDE.md)
      mv "$f" "$DOCS_GUIDES_DIR/"
      ;;
    COMPLETE_TEST_RESULTS.md|TESTING_RESULTS.md|TESTING_STATUS.md|JUDGMENT_TEST_RESULTS.md|VERIFICATION_REPORT.md)
      mv "$f" "$DOCS_TESTS_DIR/"
      ;;
    IMPROVEMENTS_*|SUMMARY_EXTENSION_AND_LIMITS.md|EXTENSION_*|DEBUG_EXTENSION_ACTIVATION.md|HOW_TO_RUN_EXTENSION.md)
      mv "$f" "$DOCS_EXTENSION_DIR/"
      ;;
    *)
      mv "$f" "$DOCS_REPORTS_DIR/"
      ;;
  esac
done

# Move raw Slack data files
for f in customer_engagement_*.*; do
  [ -e "$f" ] || continue
  mv "$f" "$SLACK_RAW_DIR/"
done

# Move intermediate/progress files
for f in thread_timestamps.json thread_replies_progress.json thread_ingestion_progress.json ingestion_progress.json; do
  if [ -e "$f" ]; then
    mv "$f" "$INTERMEDIATE_DIR/"
  fi
done

# Move logs
for f in *.log; do
  [ -e "$f" ] || continue
  mv "$f" "$BACKUP_DIR/logs/"
done
if [ -d logs ]; then
  mv logs "$BACKUP_DIR/logs/"
fi
if [ -f backend_dev.log ]; then
  mv backend_dev.log "$BACKUP_DIR/logs/"
fi

# Move node_modules
if [ -d node_modules ]; then
  mv node_modules "$BACKUP_DIR/node_modules/"
fi

# Archive Cursor extension
if [ -d cursor_extension ]; then
  mv cursor_extension "$EXTENSION_ARCHIVE_DIR/"
fi

# Move any remaining root-level items not in keep list
KEEP_ITEMS=(
  "."
  ".."
  ".cursor"
  ".env"
  ".env.example"
  ".git"
  ".gitignore"
  "backend"
  "scripts"
  "specs"
  "output"
  "exports"
  "data"
  "docs"
  "backup"
  "package.json"
  "package-lock.json"
  "tsconfig.json"
  "jest.config.js"
  "README.md"
)

for item in * .*; do
  [ "$item" = "." ] && continue
  [ "$item" = ".." ] && continue
  is_keep=false
  for keep in "${KEEP_ITEMS[@]}"; do
    if [ "$item" = "$keep" ]; then
      is_keep=true
      break
    fi
  done
  if [ "$is_keep" = false ]; then
    mv "$item" "$BACKUP_DIR/misc/"
  fi
done

echo "Reorg complete."
