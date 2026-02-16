#!/usr/bin/env bash
# Monitor ingestion progress every 5 minutes.
# Writes to output/ingestion_monitor.log and prints to stdout.
# Usage: bash scripts/monitor_ingestion.sh
#
# Stops automatically when both PIDs are gone.

INGESTION_PID=41854
PIPELINE_PID=45614
TOTAL_SIGNALS=15054
LOG_FILE="output/ingestion_monitor.log"
INTERVAL_SECONDS=300  # 5 minutes

mkdir -p output

echo "========================================" | tee -a "$LOG_FILE"
echo "Ingestion Monitor started at $(date -u '+%Y-%m-%dT%H:%M:%SZ')" | tee -a "$LOG_FILE"
echo "Ingestion PID: $INGESTION_PID | Pipeline PID: $PIPELINE_PID" | tee -a "$LOG_FILE"
echo "Total corpus signals: $TOTAL_SIGNALS" | tee -a "$LOG_FILE"
echo "Check interval: ${INTERVAL_SECONDS}s (5 min)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

check_count=0

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

  pct_signals=$((signals * 100 / TOTAL_SIGNALS))
  pct_extracted=$((extractions * 100 / TOTAL_SIGNALS))

  line="[$ts] Check #$check_count | Ingestion: $ingestion_alive | Pipeline: $pipeline_alive | Signals: $signals/$TOTAL_SIGNALS ($pct_signals%) | Extractions: $extractions ($pct_extracted%) | Failed: $failed | Entities: $entities"
  echo "$line" | tee -a "$LOG_FILE"

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
