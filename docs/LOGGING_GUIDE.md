# Comprehensive Logging Guide

## Overview

The PM Intelligence System includes detailed structured logging throughout the ingestion and processing pipeline. This guide explains how to use logs for debugging, monitoring, and troubleshooting.

## Log Structure

All logs follow a consistent structured format with these key fields:

```json
{
  "stage": "stage_name",           // Current processing stage
  "status": "status_value",        // start|success|error|warning|skipped
  "elapsedMs": 1234,              // Duration in milliseconds
  "errorClass": "ErrorName",      // Error type (if applicable)
  "errorMessage": "details",      // Error message (if applicable)
  "nextAction": "action",         // What happens next
  // Stage-specific fields
}
```

## Key Logging Stages

### 1. Signal Processing Pipeline

**Stage**: `signal`
**Location**: `backend/services/ingestion_pipeline_service.ts`

```json
// Signal start
{
  "stage": "signal",
  "status": "start",
  "signalId": "uuid",
  "source": "slack",
  "signalType": "message",
  "runId": "batch_run_id",
  "batchIndex": 0
}

// Signal complete
{
  "stage": "signal",
  "status": "success",
  "signalId": "uuid",
  "elapsedMs": 5234
}
```

**How to use**: Track individual signal processing, identify slow signals, find failed signals.

```bash
# Find all failed signals
grep '"stage":"signal"' logs.json | grep '"status":"error"'

# Find slow signals (>10 seconds)
grep '"stage":"signal"' logs.json | grep '"elapsedMs":[1-9][0-9][0-9][0-9][0-9]'

# Track a specific signal through the pipeline
grep '"signalId":"abc-123"' logs.json
```

### 2. LLM Extraction

**Stage**: `llm_extraction`
**Location**: `backend/services/llm_extraction_service.ts`

```json
// Extraction complete
{
  "stage": "llm_extraction",
  "status": "success",
  "elapsedMs": 2341,
  "extractionMethod": "llm",       // or "heuristic"
  "usedSecondPass": false,
  "entities": {
    "customers": 2,
    "features": 3,
    "issues": 1,
    "themes": 1,
    "stakeholders": 0
  },
  "relationships": 5,
  "sentiment": "positive",
  "urgency": "medium",
  "signalCategory": "product_issue",
  "hallucinationFilterApplied": true,
  "entitiesRemovedByFilter": {
    "customers": 1,
    "features": 0
  }
}
```

**How to use**: Monitor extraction quality, identify hallucinations, track extraction performance.

```bash
# Find extractions that needed second pass
grep '"usedSecondPass":true' logs.json

# Find extractions with hallucinations removed
grep '"hallucinationFilterApplied":true' logs.json | grep -v '"customers":0'

# Find extractions that fell back to heuristics
grep '"extractionMethod":"heuristic"' logs.json

# Calculate average extraction time
grep '"stage":"llm_extraction"' logs.json | jq '.elapsedMs' | awk '{sum+=$1; count++} END {print sum/count}'
```

### 3. Entity Resolution

**Stage**: `entity_resolution`
**Location**: `backend/services/entity_resolution_service.ts`

```json
// Resolution via alias match (fastest path)
{
  "stage": "entity_resolution",
  "status": "success",
  "method": "alias_match",
  "mention": "MSFT",
  "entityType": "customer",
  "resolvedEntityId": "uuid",
  "resolvedEntityName": "Microsoft",
  "confidence": 1.0,
  "elapsedMs": 12
}

// Resolution via LLM matching
{
  "stage": "entity_resolution",
  "status": "success",
  "method": "llm_auto_merge",
  "mention": "Microsoft Corp",
  "entityType": "customer",
  "resolvedEntityId": "uuid",
  "resolvedEntityName": "Microsoft",
  "confidence": 0.92,
  "confidenceThreshold": 0.85,
  "aliasAdded": "Microsoft Corp",
  "reasoning": "Same organization, different naming",
  "elapsedMs": 1523
}

// Human review required
{
  "stage": "entity_resolution",
  "status": "success",
  "method": "llm_human_review",
  "mention": "MS",
  "entityType": "customer",
  "resolvedEntityId": "uuid",
  "resolvedEntityName": "Microsoft",
  "confidence": 0.73,
  "confidenceRange": "0.65-0.85",
  "reasoning": "Likely match but needs confirmation",
  "feedbackStatus": "pending"
}

// New entity created
{
  "stage": "entity_resolution",
  "status": "success",
  "method": "new_entity",
  "mention": "Acme Corp",
  "entityType": "customer",
  "canonicalName": "Acme Corporation",
  "canonicalFormMethod": "llm_extracted",
  "createdEntityId": "uuid",
  "confidence": 1.0
}
```

**How to use**: Debug entity matching issues, find resolution bottlenecks, monitor entity creation.

```bash
# Find all alias matches (fast path)
grep '"method":"alias_match"' logs.json

# Find all new entities created
grep '"method":"new_entity"' logs.json

# Find entities needing human review
grep '"method":"llm_human_review"' logs.json

# Find high-confidence LLM merges
grep '"method":"llm_auto_merge"' logs.json | grep '"confidence":0\.[89]'

# Find slow entity resolutions (>1 second)
grep '"stage":"entity_resolution"' logs.json | grep '"elapsedMs":[1-9][0-9][0-9][0-9]'

# Track resolution of a specific mention
grep '"mention":"Microsoft"' logs.json | grep '"stage":"entity_resolution"'
```

### 4. LLM Entity Matcher

**Stage**: `llm_entity_matcher`
**Location**: `backend/services/llm_entity_matcher.ts`

```json
// Matching complete
{
  "stage": "llm_entity_matcher",
  "status": "success",
  "mention": "auth bug",
  "matchedEntityId": "uuid",
  "matchedEntityName": "Authentication Issue",
  "confidence": 0.88,
  "reasoning": "Refers to authentication problems",
  "suggestedAliasCount": 2,
  "candidatesEvaluated": 5,
  "elapsedMs": 1234
}

// Canonical form extraction
{
  "stage": "llm_canonical_form",
  "status": "success",
  "mention": "auth timeout",
  "canonicalName": "Authentication Timeout",
  "elapsedMs": 876,
  "llmDurationMs": 823
}
```

**How to use**: Debug LLM matching decisions, monitor LLM performance.

```bash
# Find LLM matcher timeouts
grep '"stage":"llm_entity_matcher"' logs.json | grep '"status":"error"' | grep -i timeout

# Find low-confidence matches
grep '"stage":"llm_entity_matcher"' logs.json | grep '"confidence":0\.[0-6]'

# Calculate average LLM matching time
grep '"stage":"llm_entity_matcher"' logs.json | jq '.elapsedMs' | awk '{sum+=$1; count++} END {print sum/count}'
```

### 5. Relationship Extraction

**Stage**: `relationship_extraction`
**Location**: `backend/services/relationship_extraction_service.ts`

```json
// Extraction complete
{
  "stage": "relationship_extraction",
  "status": "success",
  "signalId": "uuid",
  "totalRelationships": 8,
  "skippedSelfReferences": 2,
  "skippedDuplicates": 1,
  "relationshipTypes": {
    "explicit": 3,
    "inferred": 5
  },
  "elapsedMs": 2345
}

// Individual relationship added
{
  "stage": "relationship_extraction",
  "status": "relationship_added",
  "fromName": "Microsoft",
  "fromType": "customer",
  "fromId": "uuid1",
  "toName": "Office 365",
  "toType": "feature",
  "toId": "uuid2",
  "relationship": "USES"
}
```

**How to use**: Debug relationship extraction, monitor inference quality.

```bash
# Find signals with many relationships
grep '"stage":"relationship_extraction"' logs.json | jq 'select(.totalRelationships > 10)'

# Find signals with self-references (should be 0)
grep '"skippedSelfReferences":[1-9]' logs.json

# Track all relationships for a signal
grep '"signalId":"abc-123"' logs.json | grep '"stage":"relationship_extraction"'
```

### 6. Neo4j Sync

**Stage**: `neo4j_entity_sync`, `neo4j_relationship_sync`
**Location**: `backend/services/neo4j_sync_service.ts`

```json
// Successful sync
{
  "stage": "neo4j_entity_sync",
  "status": "success",
  "entityId": "uuid",
  "entityType": "customer"
}

// Failed sync (enqueued to backlog)
{
  "stage": "neo4j_entity_sync",
  "status": "error",
  "errorClass": "TimeoutError",
  "errorMessage": "Neo4j operation timeout",
  "isTimeout": true,
  "timeoutMs": 10000,
  "entityId": "uuid",
  "nextAction": "enqueue_backlog"
}
```

**How to use**: Monitor Neo4j sync health, identify timeout issues.

```bash
# Find Neo4j timeouts
grep '"stage":"neo4j_' logs.json | grep '"isTimeout":true'

# Find failed syncs
grep '"stage":"neo4j_' logs.json | grep '"status":"error"'

# Monitor backlog growth
grep '"nextAction":"enqueue_backlog"' logs.json | wc -l
```

## Log Levels

### DEBUG
- Detailed step-by-step execution
- Candidates considered for matching
- Prompt/response previews
- Use for deep troubleshooting

### INFO
- Completed operations with metrics
- Resolution decisions
- Performance metrics
- Use for monitoring and analytics

### WARN
- Degraded operation (e.g., LLM fallback to heuristics)
- Non-fatal errors
- Configuration issues
- Use for operational awareness

### ERROR
- Failed operations
- Exceptions with stack traces
- Critical failures
- Use for incident response

## Tracing End-to-End Flows

### Trace a Single Signal

```bash
# Extract signalId from initial log
SIGNAL_ID="abc-123-def-456"

# Get all logs for this signal
grep "\"signalId\":\"$SIGNAL_ID\"" logs.json | jq .

# Summary of stages
grep "\"signalId\":\"$SIGNAL_ID\"" logs.json | jq -r '.stage' | sort | uniq -c
```

### Trace a Batch Run

```bash
# Extract runId
RUN_ID="batch_20260217_123456"

# Get all signals in batch
grep "\"runId\":\"$RUN_ID\"" logs.json

# Count successes vs failures
grep "\"runId\":\"$RUN_ID\"" logs.json | grep '"stage":"signal"' | grep -c '"status":"success"'
grep "\"runId\":\"$RUN_ID\"" logs.json | grep '"stage":"signal"' | grep -c '"status":"error"'
```

### Find Performance Bottlenecks

```bash
# Find slowest stages across all signals
grep '"elapsedMs"' logs.json | jq -r '"\(.stage) \(.elapsedMs)"' | awk '{sum[$1]+=$2; count[$1]++} END {for (stage in sum) print stage, sum[stage]/count[stage]}' | sort -k2 -rn

# Find P95 latency per stage
grep '"elapsedMs"' logs.json | jq -r 'select(.stage=="entity_resolution") | .elapsedMs' | sort -n | awk '{a[NR]=$1} END {print a[int(NR*0.95)]}'
```

## Log Correlation

All logs within a signal's processing share the same `signalId`. Many also include:
- `runId`: Batch processing identifier
- `batchIndex`: Position within batch
- `entityType`, `mention`: Entity context
- `stage`: Processing stage

Use these fields to correlate logs across different services and stages.

## Monitoring Best Practices

1. **Set up log aggregation**: Use ELK, Splunk, or CloudWatch for centralized logging
2. **Create dashboards**: Track key metrics (throughput, error rates, latency)
3. **Set alerts**:
   - Error rate > 5%
   - P95 latency > 10 seconds
   - Neo4j backlog growing
   - LLM timeout rate > 1%
4. **Regular analysis**: Review logs weekly for patterns, optimization opportunities

## Example Queries

### Find all errors in the last hour
```bash
# Assuming ISO timestamp in logs
jq -r 'select(.level=="error" and .timestamp > "'$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)'")' logs.json
```

### Calculate success rate
```bash
TOTAL=$(grep '"stage":"signal"' logs.json | grep '"status":"' | wc -l)
SUCCESS=$(grep '"stage":"signal"' logs.json | grep '"status":"success"' | wc -l)
echo "Success rate: $(echo "scale=2; $SUCCESS * 100 / $TOTAL" | bc)%"
```

### Find most common errors
```bash
grep '"status":"error"' logs.json | jq -r '.errorMessage' | sort | uniq -c | sort -rn | head -10
```

## Troubleshooting Scenarios

### Scenario: Signal takes too long to process
```bash
# Find the signal
SIGNAL_ID="slow-signal-id"

# Get timing breakdown
grep "\"signalId\":\"$SIGNAL_ID\"" logs.json | jq 'select(.elapsedMs != null) | {stage, elapsedMs}' | sort -k2 -rn
```

### Scenario: Entity not being matched correctly
```bash
# Find all resolution attempts for entity
MENTION="Microsoft"

grep "\"mention\":\"$MENTION\"" logs.json | grep '"stage":"entity_resolution"' | jq '{method, confidence, resolvedEntityName, reasoning}'
```

### Scenario: LLM extraction quality issues
```bash
# Find extractions with low entity counts
grep '"stage":"llm_extraction"' logs.json | jq 'select(.entities.customers + .entities.features + .entities.issues < 2)'

# Find heuristic fallbacks
grep '"extractionMethod":"heuristic"' logs.json
```

## Configuration

Set log level via environment variable:
```bash
LOG_LEVEL=debug  # debug, info, warn, error
```

Enable structured JSON logging:
```bash
LOG_FORMAT=json  # json, pretty
```

## Summary

The comprehensive logging system provides:
- **End-to-end traceability** via signalId
- **Performance metrics** at every stage
- **Decision reasoning** for LLM operations
- **Error context** for debugging
- **Operational metrics** for monitoring

Use this guide to effectively debug issues, monitor system health, and optimize performance.
