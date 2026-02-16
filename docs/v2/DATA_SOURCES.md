# Data Source Reference

## Overview
This document describes the location and structure of all data sources for the PM Intelligence System.

---

## Community Forum Data

**Location:** `data/raw/community_forums/aem_forms_full_dump.json`

**Details:**
- Size: 11 MB
- Format: JSON array of forum thread objects
- Record Count: **3,028 threads**

**Structure:**
```json
[
  {
    "id": "thread_123",
    "title": "PDF generation fails in AEM Forms",
    "body": "Thread body text...",
    "author": "user@example.com",
    "created_at": "2024-01-15T10:30:00Z",
    "replies": [
      {
        "id": "reply_456",
        "body": "Reply text...",
        "author": "helper@example.com",
        "created_at": "2024-01-15T11:00:00Z"
      }
    ],
    "accepted_answer": {
      "id": "reply_789",
      "body": "Solution text...",
      "author": "expert@example.com"
    },
    "tags": ["pdf", "forms", "troubleshooting"],
    "view_count": 150,
    "reply_count": 5
  }
]
```

**Ingestion Script:** `scripts/ingest_community_forums_v2.ts`

**Command:**
```bash
npm run ingest-forums -- --skip-boilerplate --resume
```

---

## Slack Data

**Location:** `data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json`

**Details:**
- Size: 6.9 MB
- Format: JSON array of channel objects with messages
- Record Count: **6 channel objects** (containing many messages)

**Structure:**
```json
[
  {
    "channel_id": "C04D195JVGS",
    "channel_name": "customer-engagement",
    "messages": [
      {
        "ts": "1705320600.000100",
        "user": "U123456",
        "text": "Customer Acme Corp reporting login issues",
        "thread_ts": "1705320600.000100",
        "reply_count": 3,
        "reactions": [
          {
            "name": "eyes",
            "count": 2
          }
        ]
      }
    ]
  }
]
```

**Ingestion Script:** `scripts/ingest_slack_batch.ts`

**Command:**
```bash
npm run ingest-slack
```

**Configuration (in .env):**
```bash
SLACK_CHANNEL_IDS=C04D195JVGS,C08T43UHK9D
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_BATCH_SIZE=200
SLACK_MAX_MESSAGES_PER_CHANNEL=10000
SLACK_INCLUDE_THREADS=true
```

---

## Intermediate Data (Checkpoints)

**Location:** `data/intermediate/`

**Files:**
- `ingestion_progress.json` - Tracks forum ingestion progress
- `thread_replies_progress.json` - Tracks reply processing
- `thread_timestamps.json` - Timestamp cache for deduplication

**Purpose:** Enable resume functionality for long-running ingestion jobs

**Cleanup:** Automatically cleared by `scripts/reset_system.sh`

---

## Output Data

**Location:** `output/`

**Generated Files:**
- `slack_ingestion_summary.json` - Slack ingestion stats
- `forum_ingestion_summary.json` - Forum ingestion stats
- `weekly_digest_YYYY-MM-DD.md` - Weekly report digests
- `slo_baseline.json` - SLO baseline metrics

**Purpose:** Store ingestion summaries and generated reports

**Cleanup:** Cleared by `scripts/reset_system.sh`

---

## Expected Data Volume (Post-Ingestion)

After ingesting both Slack and forum data:

| Database | Table | Expected Count |
|----------|-------|----------------|
| PostgreSQL | signals | ~6,000-8,000 |
| PostgreSQL | signal_extractions | ~6,000-8,000 |
| PostgreSQL | entity_registry | ~500-1,000 |
| PostgreSQL | entity_resolution_log | ~15,000-25,000 |
| PostgreSQL | opportunities | ~50-150 |
| Neo4j | Entity Nodes | ~500-1,000 |
| Neo4j | Relationships | ~5,000-10,000 |

**Notes:**
- Signal count depends on forum threads + replies + Slack messages
- Entity resolution creates multiple log entries per signal
- Opportunities detected based on signal clustering

---

## Data Verification Commands

**Check data file integrity:**
```bash
# Community forum
jq 'length' data/raw/community_forums/aem_forms_full_dump.json
jq '.[0] | keys' data/raw/community_forums/aem_forms_full_dump.json

# Slack
jq 'length' data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json
jq '.[0] | keys' data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json
```

**Check system status:**
```bash
./scripts/check_system_status.sh
```

**Reset system:**
```bash
./scripts/reset_system.sh
```

---

## Data Privacy & Handling

**PII Considerations:**
- Forum data may contain email addresses, names
- Slack data contains user IDs, message content
- Customer names extracted as entities

**Recommendations:**
- Review data privacy policy before production
- Consider PII scrubbing for customer names
- Implement data retention policy
- Ensure GDPR compliance if applicable

**Current Implementation:**
- No PII scrubbing in place (development/test environment)
- All data stored as-is for testing purposes
- Production deployment should add anonymization layer

---

## Troubleshooting

**Issue: Forum data file not found**
- Verify path: `data/raw/community_forums/aem_forms_full_dump.json`
- Check if file exists: `ls -lh data/raw/community_forums/`
- File should be 11MB with 3,028 threads

**Issue: Slack data file not found**
- Verify path: `data/raw/slack/C04D195JVGS/`
- Check channel ID matches configured channels
- Ensure export includes `_complete.json` suffix

**Issue: Corrupted data files**
- Validate JSON: `jq . data/raw/community_forums/aem_forms_full_dump.json > /dev/null`
- Check for syntax errors
- Re-export data if needed

---

## Next Steps

Before ingestion:
1. ✅ Verify data files exist and are readable
2. ✅ Check record counts match expected values
3. ✅ Run system reset: `./scripts/reset_system.sh`
4. ✅ Follow pre-flight checklist: [PREFLIGHT_CHECKLIST.md](PREFLIGHT_CHECKLIST.md)

During ingestion:
1. Monitor progress: `tail -f logs/ingestion.log`
2. Watch SLO dashboard: `npm run slo:dashboard -- --watch`
3. Check intermediate progress files for resume capability

After ingestion:
1. Verify data counts: `./scripts/check_system_status.sh`
2. Run data quality checks: `npm run agent:data-quality`
3. Follow testing guide: [FINAL_TESTING_GUIDE.md](FINAL_TESTING_GUIDE.md)
