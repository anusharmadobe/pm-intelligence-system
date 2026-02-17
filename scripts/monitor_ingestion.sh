#!/usr/bin/env bash
# Monitor ingestion progress every 5 minutes.
# Writes to output/ingestion_monitor.log and prints to stdout.
# Usage:
#   bash scripts/monitor_ingestion.sh <ingestion_pid> <pipeline_pid> [total_signals]
# Or set env vars:
#   INGESTION_PID, PIPELINE_PID, TOTAL_SIGNALS, INTERVAL_SECONDS, LOG_FILE
#
# Stops automatically when both PIDs are gone.

INGESTION_PID=${INGESTION_PID:-${1:-}}
PIPELINE_PID=${PIPELINE_PID:-${2:-}}
TOTAL_SIGNALS=${TOTAL_SIGNALS:-${3:-0}}
LOG_FILE=${LOG_FILE:-"output/ingestion_monitor.log"}
INTERVAL_SECONDS=${INTERVAL_SECONDS:-300}  # 5 minutes
STALL_THRESHOLD=${STALL_THRESHOLD:-3}

if [ -z "$INGESTION_PID" ] && [ -z "$PIPELINE_PID" ]; then
  echo "Error: Provide ingestion and/or pipeline PID."
  echo "Usage: bash scripts/monitor_ingestion.sh <ingestion_pid> <pipeline_pid> [total_signals]"
  exit 1
fi

mkdir -p output

echo "========================================" | tee -a "$LOG_FILE"
echo "Ingestion Monitor started at $(date -u '+%Y-%m-%dT%H:%M:%SZ')" | tee -a "$LOG_FILE"
echo "Ingestion PID: $INGESTION_PID | Pipeline PID: $PIPELINE_PID" | tee -a "$LOG_FILE"
echo "Total corpus signals: $TOTAL_SIGNALS" | tee -a "$LOG_FILE"
echo "Check interval: ${INTERVAL_SECONDS}s (5 min)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

check_count=0
stall_count=0
prev_signals=
prev_extractions=
prev_entities=

while true; do
  check_count=$((check_count + 1))
  ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  # Check PIDs
  ingestion_alive="no"
  pipeline_alive="no"
  kill -0 "$INGESTION_PID" 2>/dev/null && ingestion_alive="yes"
  kill -0 "$PIPELINE_PID" 2>/dev/null && pipeline_alive="yes"

  # Query DB counts
  db_result=$(npx ts-node --transpile-only -e "
    import 'dotenv/config';
    import { getDbPool, closeDbPool } from './backend/db/connection';
    (async()=>{
      const p=getDbPool();
      const s=await p.query('SELECT COUNT(1)::int AS c FROM signals');
      const e=await p.query('SELECT COUNT(1)::int AS c FROM signal_extractions');
      const ent=await p.query('SELECT COUNT(1)::int AS c FROM entity_registry');
      const failed=await p.query(\"SELECT COUNT(1)::int AS c FROM signals s LEFT JOIN signal_extractions se ON se.signal_id=s.id WHERE s.source='manual' AND se.signal_id IS NULL\");
      console.log(JSON.stringify({
        signals:s.rows[0].c,
        extractions:e.rows[0].c,
        entities:ent.rows[0].c,
        failed:failed.rows[0].c
      }));
      await closeDbPool();
    })().catch(async err=>{
      console.error(JSON.stringify({error:err.message}));
      try{await closeDbPool();}catch{}
      process.exit(1);
    });
  " 2>/dev/null)

  signals=$(echo "$db_result" | grep -o '"signals":[0-9]*' | grep -o '[0-9]*')
  extractions=$(echo "$db_result" | grep -o '"extractions":[0-9]*' | grep -o '[0-9]*')
  entities=$(echo "$db_result" | grep -o '"entities":[0-9]*' | grep -o '[0-9]*')
  failed=$(echo "$db_result" | grep -o '"failed":[0-9]*' | grep -o '[0-9]*')

  signals=${signals:-0}
  extractions=${extractions:-0}
  entities=${entities:-0}
  failed=${failed:-0}

  total_signals="$TOTAL_SIGNALS"
  if [ "$total_signals" -le 0 ]; then
    total_signals="$signals"
  fi
  if [ "$total_signals" -le 0 ]; then
    total_signals=1
  fi
  pct_signals=$((signals * 100 / total_signals))
  pct_extracted=$((extractions * 100 / total_signals))

  delta_signals=0
  delta_extractions=0
  delta_entities=0
  if [ -n "$prev_signals" ]; then
    delta_signals=$((signals - prev_signals))
    delta_extractions=$((extractions - prev_extractions))
    delta_entities=$((entities - prev_entities))
  fi
  prev_signals=$signals
  prev_extractions=$extractions
  prev_entities=$entities

  line="[$ts] Check #$check_count | Ingestion: $ingestion_alive | Pipeline: $pipeline_alive | Signals: $signals/$total_signals ($pct_signals%) | Extractions: $extractions ($pct_extracted%) | Failed: $failed | Entities: $entities | ΔSignals: $delta_signals | ΔExtractions: $delta_extractions | ΔEntities: $delta_entities"
  echo "$line" | tee -a "$LOG_FILE"

  # Stall detection: no progress for N intervals
  if [ "$delta_signals" -eq 0 ] && [ "$delta_extractions" -eq 0 ] && [ "$delta_entities" -eq 0 ]; then
    stall_count=$((stall_count + 1))
  else
    stall_count=0
  fi

  if [ "$stall_count" -ge "$STALL_THRESHOLD" ]; then
    cursor_info=$(cat output/ingestion_cursor.json 2>/dev/null | tr -d '\n' | cut -c1-200)
    echo "[$ts] STALLED: No progress for $stall_count intervals (threshold=$STALL_THRESHOLD)." | tee -a "$LOG_FILE"
    if [ -n "$cursor_info" ]; then
      echo "[$ts] Cursor: $cursor_info" | tee -a "$LOG_FILE"
    fi
    echo "[$ts] Recommendation: stop ingestion and run pipeline separately (npm run pipeline:skip-ingestion)." | tee -a "$LOG_FILE"
  fi

  # Stop conditions
  if [ "$ingestion_alive" = "no" ] && [ "$pipeline_alive" = "no" ]; then
    echo "[$ts] Both processes have exited. Monitor stopping." | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "=== FINAL SUMMARY ===" | tee -a "$LOG_FILE"
    echo "Signals ingested: $signals / $TOTAL_SIGNALS ($pct_signals%)" | tee -a "$LOG_FILE"
    echo "Extractions completed: $extractions ($pct_extracted%)" | tee -a "$LOG_FILE"
    echo "Failed (no extraction): $failed" | tee -a "$LOG_FILE"
    echo "Entities resolved: $entities" | tee -a "$LOG_FILE"

    # Check if pipeline output exists
    if [ -d "output/forum_azure_full_run" ]; then
      echo "Pipeline output directory exists: output/forum_azure_full_run/" | tee -a "$LOG_FILE"
      ls -la output/forum_azure_full_run/ 2>/dev/null | tee -a "$LOG_FILE"
    else
      echo "Pipeline output directory NOT found yet." | tee -a "$LOG_FILE"
    fi
    echo "=== END ===" | tee -a "$LOG_FILE"
    break
  fi

  # If ingestion done but pipeline now running, note it
  if [ "$ingestion_alive" = "no" ] && [ "$pipeline_alive" = "yes" ]; then
    echo "[$ts]   -> Ingestion finished. PM pipeline is now running..." | tee -a "$LOG_FILE"
  fi

  sleep "$INTERVAL_SECONDS"
done
