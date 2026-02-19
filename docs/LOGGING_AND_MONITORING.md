# Logging and Monitoring Guide

## Overview

The PM Intelligence System now has comprehensive logging with periodic progress updates for long-running operations. This guide explains how to configure logging and monitor pipeline progress.

---

## Table of Contents

1. [Log Levels](#log-levels)
2. [Module-Specific Logging](#module-specific-logging)
3. [Monitoring Tools](#monitoring-tools)
4. [Pipeline Stages](#pipeline-stages)
5. [Troubleshooting](#troubleshooting)

---

## Log Levels

### Available Levels

| Level | Priority | Usage | When to Use |
|-------|----------|-------|-------------|
| `error` | 0 (highest) | Critical failures | External service failures, data corruption |
| `warn` | 1 | Fallback behaviors | Configuration issues, performance degradation |
| `info` | 2 | Operation start/complete | User actions, major operations (default for production) |
| `debug` | 3 | Detailed steps | Decision points, intermediate results |
| `trace` | 4 (lowest) | Ultra-detailed | Every comparison, full LLM prompts/responses |

### Global Log Level

Set in [.env](.env):

```bash
LOG_LEVEL=info
```

---

## Module-Specific Logging

You can set different log levels for different modules. This allows you to get detailed logs for one area while keeping others quiet.

### Configuration

```bash
# Global log level (fallback)
LOG_LEVEL=info

# Module-specific overrides
LOG_LEVEL_OPPORTUNITY=debug        # Opportunity clustering & merge
LOG_LEVEL_ENTITY_RESOLUTION=debug  # Entity matching & merge
LOG_LEVEL_JIRA=debug              # JIRA generation
LOG_LEVEL_EXPORT=info             # Data exports
LOG_LEVEL_LLM=debug               # All LLM operations
LOG_LEVEL_DATABASE=warn           # Database operations
LOG_LEVEL_MCP=info                # MCP server operations

# Infrastructure & Utilities
LOG_LEVEL_CORRELATION=info        # Correlation ID middleware
LOG_LEVEL_CACHE=info              # LRU cache operations
LOG_LEVEL_RETRY=info              # Retry logic and circuit breaker
LOG_LEVEL_REDIS=info              # Redis connection management
LOG_LEVEL_HEALTH=info             # Health check endpoints

# Services
LOG_LEVEL_FAILED_SIGNAL_RETRY=info    # Failed signal retry mechanism
LOG_LEVEL_FILE_VALIDATION=debug       # File upload validation
LOG_LEVEL_WEBSITE_CRAWLER=info        # Website crawling
LOG_LEVEL_HYBRID_SEARCH=info          # Hybrid search operations
```

> **📖 See [CONFIGURABLE_LOGGING.md](./CONFIGURABLE_LOGGING.md) for a complete guide** with all module-specific environment variables, debugging scenarios, log filtering examples, and performance recommendations.

### Example: Debug Opportunity Clustering Only

```bash
# Quiet everything except opportunity clustering
LOG_LEVEL=info
LOG_LEVEL_OPPORTUNITY=debug
```

### Example: Trace LLM Operations

```bash
# See all LLM prompts and responses
LOG_LEVEL=info
LOG_LEVEL_LLM=trace
```

---

## Monitoring Tools

### 1. Real-Time Pipeline Monitor (Recommended)

**Best for:** Watching active pipeline runs with live progress updates

```bash
npm run pipeline:monitor
```

**Features:**
- Real-time progress bars
- ETA calculations
- Database statistics
- Multi-stage tracking
- Color-coded status
- Refreshes every 5 seconds

**Screenshot:**
```
╔═══════════════════════════════════════════════════════════════════════════╗
║             PM Intelligence Pipeline Status Monitor                       ║
╚═══════════════════════════════════════════════════════════════════════════╝

📊 Database Statistics:
   Total Signals:          10,523
   With Extractions:       10,523 (100.0%)
   With Embeddings:        8,234 (78.2%)
   Total Opportunities:    156
   Entities Resolved:      2,341

🔄 Active Pipeline Stages:

▸ OPPORTUNITY_CLUSTERING
  Status: in_progress
  Progress: [████████████████████░░░░░░░░░░] 65.3%
  Processed: 6,871 / 10,523
  Rate: 123.45 items/sec
  ETA: 29s
  Elapsed: 55.6s
  Last Update: 14:23:45

▸ EMBEDDING_GENERATION
  Status: batch_complete
  Progress: [██████████████████████████████] 100.0%
  Processed: 500 / 500
  Rate: 45.23 items/sec
  Last Update: 14:23:42

Press Ctrl+C to exit
Last refreshed: 14:23:45
```

**Options:**
```bash
# One-time check (no live updates)
npm run pipeline:monitor-once

# Custom refresh interval (10 seconds)
npm run pipeline:monitor -- --interval 10
```

---

### 2. Simple Log Watcher

**Best for:** Quick log tailing with color-coding

```bash
./scripts/watch-pipeline.sh
```

**Filter by stage:**
```bash
./scripts/watch-pipeline.sh clustering   # Only clustering logs
./scripts/watch-pipeline.sh embedding    # Only embedding logs
./scripts/watch-pipeline.sh error        # Only errors
```

**Features:**
- Colorized output
- Real-time streaming
- Filtered by stage
- Extracts key metrics

---

### 3. Direct Log Tailing

**Best for:** Raw log inspection

```bash
# All logs
tail -f logs/combined.log

# Filter for progress logs
tail -f logs/combined.log | grep progress

# Filter for specific stage
tail -f logs/combined.log | grep opportunity_clustering

# Errors only
tail -f logs/error.log
```

---

### 4. npm Script for Quick Filtering

```bash
npm run logs:pipeline
```

Equivalent to:
```bash
tail -f logs/combined.log | grep -E 'stage|progress|clustering|embedding'
```

---

## Pipeline Stages

### Ingestion Pipeline

**Stage:** `ingestion_pipeline`

**Logs:**
- Overall progress (every 10 seconds)
- Rate (signals/sec)
- ETA
- Active workers

**Example Log:**
```json
{
  "stage": "ingestion_pipeline",
  "status": "in_progress",
  "completed": 5000,
  "total": 10000,
  "progress_pct": "50.0",
  "rate_per_sec": "125.34",
  "eta_seconds": "39",
  "elapsed_ms": 39876,
  "active_workers": 5
}
```

---

### Signal Clustering

**Stage:** `opportunity_clustering`

**Logs:**
- Progress every 5 seconds
- Clusters formed
- Rate (signals/sec)
- ETA

**Example Log:**
```json
{
  "stage": "opportunity_clustering",
  "status": "in_progress",
  "processed": 2500,
  "total": 10000,
  "progress_pct": "25.0",
  "clusters_formed": 145,
  "rate_per_sec": "98.45",
  "eta_seconds": "76",
  "elapsed_ms": 25384
}
```

---

### Incremental Detection

**Stage:** `incremental_detection`

**Logs:**
- Signal matching progress (every 5 seconds)
- Matched vs unmatched counts
- Updated opportunities

**Example Log:**
```json
{
  "stage": "incremental_detection",
  "status": "matching_in_progress",
  "processed": 150,
  "total": 500,
  "progress_pct": "30.0",
  "matched_so_far": 45,
  "updated_opportunities": 12,
  "rate_per_sec": "12.34",
  "eta_seconds": "28"
}
```

---

### LLM Extraction

**Stage:** `llm_extraction`

**Logs:**
- Entity counts
- Relationship creation progress (for large batches > 100)

**Example Log:**
```json
{
  "stage": "llm_extraction",
  "status": "relationships_progress",
  "signal_id": "abc123",
  "processed": 250,
  "total": 500,
  "progress_pct": "50.0"
}
```

---

### Embedding Generation

**Stage:** `embedding_generation`

**Logs:**
- Batch progress
- Rate (embeddings/sec)
- ETA
- Success/failure counts

**Example Log:**
```json
{
  "stage": "embedding_generation",
  "status": "batch_complete",
  "batch_number": 5,
  "total_batches": 10,
  "batch_duration_ms": 2345,
  "successful_so_far": 450,
  "failed_so_far": 5,
  "total_processed": 500,
  "total_signals": 1000,
  "progress_pct": "50.0",
  "rate_per_sec": "45.23",
  "eta_seconds": "11"
}
```

---

### Opportunity Storage

**Stage:** `opportunity_storage`

**Logs:**
- Opportunity creation
- Signal linking
- Success/failure

**Example Log:**
```json
{
  "stage": "opportunity_storage",
  "status": "success",
  "opportunity_id": "opp_123",
  "title": "Dashboard Performance Issues",
  "signal_count": 15,
  "duration_ms": 234
}
```

---

## Troubleshooting

### Pipeline Appears Frozen

**Symptoms:**
- No log output for several minutes
- Monitoring script shows stale data

**Solutions:**

1. **Check if process is running:**
   ```bash
   ps aux | grep ts-node
   ```

2. **Check current log level:**
   ```bash
   cat .env | grep LOG_LEVEL
   ```

   If `LOG_LEVEL=error`, you won't see progress logs!

   **Fix:**
   ```bash
   LOG_LEVEL=info
   LOG_LEVEL_OPPORTUNITY=debug
   ```

3. **Check if clustering is just slow:**
   - With 10,000+ signals, clustering can take 10-30 minutes
   - Progress logs appear every 5 seconds
   - If truly frozen, check `logs/error.log`

4. **Force a progress log:**
   - Logs appear based on time intervals (5-10 seconds)
   - Wait at least 10 seconds before assuming it's frozen

---

### No Logs Appearing

**Possible Causes:**

1. **Log level too high:**
   ```bash
   # This will hide progress logs!
   LOG_LEVEL=error

   # Fix:
   LOG_LEVEL=info
   ```

2. **Logs directory doesn't exist:**
   ```bash
   mkdir -p logs
   ```

3. **Pipeline not started:**
   - Make sure you've actually started the pipeline!
   - Check `ps aux | grep pipeline`

---

### Logs Too Verbose

**Problem:** Thousands of trace logs cluttering output

**Solution:** Adjust log levels

```bash
# Too verbose
LOG_LEVEL_OPPORTUNITY=trace  # Shows EVERY signal comparison!

# Better
LOG_LEVEL_OPPORTUNITY=debug  # Shows decisions and progress

# Even quieter
LOG_LEVEL_OPPORTUNITY=info   # Shows only summary stats
```

---

### Finding Specific Errors

**Search logs for errors:**
```bash
# All errors
cat logs/error.log

# Errors in last 10 minutes
find logs -name '*.log' -mmin -10 -exec grep -i error {} +

# Errors for specific stage
cat logs/combined.log | grep opportunity_clustering | grep error

# Errors with context (5 lines before/after)
cat logs/combined.log | grep -B 5 -A 5 '"status":"error"'
```

---

## Performance Impact

### Log Level Performance

| Level | Performance Impact | When to Use |
|-------|-------------------|-------------|
| `error` | ~0% | Production (minimal logging) |
| `warn` | ~0% | Production |
| `info` | ~1-2% | Production (recommended) |
| `debug` | ~3-5% | Development, troubleshooting |
| `trace` | ~10-15% | Deep debugging only |

### Periodic Logging Overhead

- Progress logs emit every **5-10 seconds**
- **Negligible overhead** (~0.1% performance impact)
- Only active during loop execution
- No overhead when loops complete

---

## Best Practices

### 1. Development

```bash
LOG_LEVEL=debug
LOG_LEVEL_OPPORTUNITY=debug
LOG_LEVEL_LLM=debug
```

**Why:** See detailed decision-making and intermediate results

---

### 2. Production

```bash
LOG_LEVEL=info
LOG_LEVEL_OPPORTUNITY=info
LOG_LEVEL_ENTITY_RESOLUTION=info
```

**Why:** Minimal overhead, shows operation start/complete

---

### 3. Debugging Specific Issue

```bash
# Clustering not working?
LOG_LEVEL=info
LOG_LEVEL_OPPORTUNITY=trace

# LLM extractions failing?
LOG_LEVEL=info
LOG_LEVEL_LLM=debug

# Database slow?
LOG_LEVEL=info
LOG_LEVEL_DATABASE=debug
```

---

### 4. Performance Testing

```bash
# Minimal logging for max performance
LOG_LEVEL=warn
```

**Why:** Reduces I/O, shows only issues

---

## Log File Management

### Log Rotation

Logs automatically rotate at:
- **5MB per file**
- **5 files retained**

### Manual Cleanup

```bash
# Clear all logs
rm -rf logs/*.log

# Archive old logs
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/
rm -rf logs/*.log
```

---

## Quick Reference

### Common Commands

```bash
# Start pipeline with monitoring
npm run pipeline &
npm run pipeline:monitor

# Watch specific stage
./scripts/watch-pipeline.sh clustering

# Check for errors
cat logs/error.log

# Get pipeline status once
npm run pipeline:monitor-once

# Tail progress logs
npm run logs:pipeline
```

### Environment Quick Setup

```bash
# For pipeline testing with progress visibility
cat >> .env << 'EOF'
LOG_LEVEL=info
LOG_LEVEL_OPPORTUNITY=debug
EOF
```

---

## See Also

- [.env.example](.env.example) - Full logging configuration examples
- [backend/utils/logger.ts](backend/utils/logger.ts) - Logger implementation
- [scripts/monitor_pipeline_status.ts](scripts/monitor_pipeline_status.ts) - Monitoring script source
