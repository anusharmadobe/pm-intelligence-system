# Testing Guide for Slack Message Ingestion

## Prerequisites

Before running the tests, ensure:

1. **PostgreSQL is running**
   ```bash
   # Check if PostgreSQL is running
   pg_isready
   # Or check with brew services
   brew services list | grep postgresql
   ```

2. **Database is set up**
   ```bash
   # Run database setup (if not already done)
   npm run setup-db-auto
   # Or manually
   npm run migrate
   ```

3. **Environment is configured**
   - `.env` file exists with database credentials
   - Database connection is verified: `npm run check`

## Test Steps

### Step 1: Verify Database Connection

```bash
npm run check
```

Expected output:
```
✅ Database connection: OK
✅ Table 'signals': EXISTS
✅ Table 'opportunities': EXISTS
✅ Table 'judgments': EXISTS
✅ Table 'artifacts': EXISTS
```

### Step 2: Check Current Signal Count

```bash
# Using psql
psql -d pm_intelligence -c "SELECT COUNT(*) FROM signals WHERE source = 'slack';"

# Or using Node.js
npx ts-node -e "
import { getSignalsBySource } from './dist/backend/processing/signal_extractor.js';
getSignalsBySource('slack').then(signals => {
    console.log('Current Slack signals:', signals.length);
    process.exit(0);
});
"
```

### Step 3: Run Ingestion Script

```bash
npx ts-node scripts/ingest_messages_now.ts
```

Expected output:
```
📥 Ingesting messages from Slack channel
==========================================
   Channel ID: C08T43UHK9D
   Channel Name: anusharm-test-channel
   Messages to ingest: 4

✅ Ingested message 1747994441... (1/4)
✅ Ingested message 1747994400... (2/4)
✅ Ingested message 1747914861... (3/4)
✅ Ingested message 1747914835... (4/4)

📊 Ingestion Summary:
   Total messages: 4
   Successfully ingested: 4
   Errors: 0

✅ All messages ingested successfully!
```

### Step 4: Verify Ingested Signals

```bash
# Check signal count
psql -d pm_intelligence -c "SELECT COUNT(*) FROM signals WHERE source = 'slack';"

# View recent signals
psql -d pm_intelligence -c "
SELECT 
    id,
    source,
    signal_type,
    LEFT(content, 80) as content_preview,
    created_at
FROM signals 
WHERE source = 'slack' 
ORDER BY created_at DESC 
LIMIT 5;
"

# View signal metadata
psql -d pm_intelligence -c "
SELECT 
    id,
    metadata->>'channel_name' as channel,
    metadata->>'user' as user_id,
    metadata->>'timestamp' as slack_timestamp,
    created_at
FROM signals 
WHERE source = 'slack' 
ORDER BY created_at DESC 
LIMIT 5;
"
```

### Step 5: Test Signal Processing

```bash
# Test signal retrieval
npx ts-node -e "
import { getAllSignals, getSignalsBySource } from './dist/backend/processing/signal_extractor.js';

async function test() {
    const allSignals = await getAllSignals();
    const slackSignals = await getSignalsBySource('slack');
    
    console.log('Total signals:', allSignals.length);
    console.log('Slack signals:', slackSignals.length);
    
    if (slackSignals.length > 0) {
        const latest = slackSignals[0];
        console.log('\nLatest signal:');
        console.log('  ID:', latest.id);
        console.log('  Type:', latest.signal_type);
        console.log('  Channel:', latest.metadata?.channel_name);
        console.log('  Content preview:', latest.content.substring(0, 100) + '...');
    }
}

test().catch(console.error);
"
```

### Step 6: Run Complete Test Suite

```bash
# Make script executable
chmod +x scripts/test_ingestion.sh

# Run test suite
./scripts/test_ingestion.sh
```

## Expected Results

After successful ingestion, you should see:

1. **4 new signals** in the database
2. **All signals** have:
   - `source = 'slack'`
   - `signal_type = 'message'`
   - `metadata` containing:
     - `channel_id: 'C08T43UHK9D'`
     - `channel_name: 'anusharm-test-channel'`
     - `user`: Slack user ID
     - `timestamp`: Slack message timestamp

3. **Signal content** includes:
   - Customer meeting notes (NFCU, IRS, LPL Financial)
   - Customer success announcement (Clark County)
   - Team reminders

## Troubleshooting

### Database Connection Failed

**Error**: `EPERM` or `Connection refused`

**Solutions**:
1. Start PostgreSQL:
   ```bash
   brew services start postgresql@17
   ```

2. Check PostgreSQL is running:
   ```bash
   pg_isready
   ```

3. Verify .env configuration:
   ```bash
   cat .env
   ```

### Migration Failed

**Error**: `Migration failed` or `Table does not exist`

**Solutions**:
1. Run migrations:
   ```bash
   npm run migrate
   ```

2. Check database exists:
   ```bash
   psql -l | grep pm_intelligence
   ```

### No Signals Ingested

**Error**: `0 signals ingested`

**Solutions**:
1. Check script output for errors
2. Verify database connection: `npm run check`
3. Check logs: `tail -f logs/combined.log`
4. Verify signal validation isn't failing

## Next Steps After Testing

Once ingestion is verified:

1. **Test Signal Processing**
   - Signal extraction and normalization
   - Opportunity detection
   - Artifact generation

2. **Test LLM Integration**
   - Signal analysis
   - Opportunity identification
   - Insight generation

3. **Test API Endpoints**
   - GET /api/signals
   - GET /api/signals?source=slack
   - POST /api/signals

4. **Test Cursor Extension**
   - Use extension command to ingest
   - Verify real-time ingestion works
