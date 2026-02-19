#!/bin/bash

# Pipeline Log Watcher
# Simple script to tail and filter pipeline logs in real-time
#
# Usage:
#   ./scripts/watch-pipeline.sh                    # Watch all pipeline logs
#   ./scripts/watch-pipeline.sh clustering         # Watch clustering logs only
#   ./scripts/watch-pipeline.sh embedding          # Watch embedding logs only
#   ./scripts/watch-pipeline.sh error              # Watch errors only

LOG_FILE="logs/combined.log"
FILTER="${1:-stage|progress}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
  echo -e "${RED}Error: Log file not found at $LOG_FILE${NC}"
  echo "Have you started the pipeline?"
  exit 1
fi

# Print header
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║${NC}            ${BOLD}PM Intelligence Pipeline Log Watcher${NC}               ${BOLD}${CYAN}║${NC}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}📁 Log file: ${NC}$LOG_FILE"
echo -e "${YELLOW}🔍 Filter: ${NC}$FILTER"
echo -e "${YELLOW}⏰ Started at: ${NC}$(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo -e "${CYAN}Press Ctrl+C to exit${NC}"
echo ""

# Function to colorize log output
colorize_log() {
  while IFS= read -r line; do
    # Extract stage and status from JSON
    if echo "$line" | grep -q '"stage"'; then
      stage=$(echo "$line" | grep -o '"stage":"[^"]*"' | cut -d'"' -f4)
      status=$(echo "$line" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
      timestamp=$(echo "$line" | grep -o '"timestamp":"[^"]*"' | cut -d'"' -f4)

      # Colorize based on status
      case "$status" in
        *start*)
          color="$YELLOW"
          ;;
        *success*|*complete*)
          color="$GREEN"
          ;;
        *error*|*failed*)
          color="$RED"
          ;;
        *progress*|*in_progress*)
          color="$CYAN"
          ;;
        *)
          color="$NC"
          ;;
      esac

      # Extract key metrics
      progress=$(echo "$line" | grep -o '"progress_pct":"[^"]*"' | cut -d'"' -f4)
      processed=$(echo "$line" | grep -o '"processed":[0-9]*' | cut -d':' -f2)
      total=$(echo "$line" | grep -o '"total":[0-9]*' | cut -d':' -f2)
      rate=$(echo "$line" | grep -o '"rate_per_sec":"[^"]*"' | cut -d'"' -f4)
      eta=$(echo "$line" | grep -o '"eta_seconds":"[^"]*"' | cut -d'"' -f4)

      # Format output
      echo -e "${BOLD}${color}[$(date -r $(date -jf "%Y-%m-%dT%H:%M:%S" "${timestamp%.*}" +%s 2>/dev/null || echo 0) '+%H:%M:%S' 2>/dev/null || echo "??:??:??")]${NC} ${BOLD}$stage${NC} → ${color}$status${NC}"

      if [ -n "$progress" ] && [ -n "$processed" ] && [ -n "$total" ]; then
        echo -e "  ${MAGENTA}Progress:${NC} $progress% ($processed/$total)"
      fi

      if [ -n "$rate" ]; then
        echo -e "  ${MAGENTA}Rate:${NC} $rate items/sec"
      fi

      if [ -n "$eta" ] && [ "$eta" != "N/A" ]; then
        echo -e "  ${MAGENTA}ETA:${NC} ${eta}s"
      fi

      echo ""
    else
      # Fallback: just print the line
      echo -e "${NC}$line"
    fi
  done
}

# Watch the log file
tail -f "$LOG_FILE" | grep --line-buffered -i "$FILTER" | colorize_log
