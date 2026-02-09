#!/bin/bash

# Test script for Slack message ingestion
# This script tests the complete ingestion pipeline

set -e

echo "🧪 Testing Slack Message Ingestion Pipeline"
echo "============================================"
echo ""

# Step 1: Check database connection
echo "Step 1: Checking database connection..."
if npm run check > /dev/null 2>&1; then
    echo "✅ Database connection: OK"
else
    echo "❌ Database connection: FAILED"
    echo "   Please ensure:"
    echo "   1. PostgreSQL is running"
    echo "   2. Database is set up (run: npm run setup-db-auto)"
    echo "   3. Migrations are run (run: npm run migrate)"
    exit 1
fi
echo ""

# Step 2: Check current signal count
echo "Step 2: Checking current signals in database..."
SIGNAL_COUNT=$(npx ts-node -e "
import { getAllSignals } from './dist/backend/processing/signal_extractor.js';
getAllSignals().then(signals => {
    console.log(signals.length);
    process.exit(0);
}).catch(err => {
    console.log('0');
    process.exit(0);
});
" 2>/dev/null || echo "0")
echo "   Current signals: $SIGNAL_COUNT"
echo ""

# Step 3: Run ingestion
echo "Step 3: Running ingestion script..."
if npx ts-node scripts/ingest_messages_now.ts; then
    echo "✅ Ingestion completed"
else
    echo "❌ Ingestion failed"
    exit 1
fi
echo ""

# Step 4: Verify new signals
echo "Step 4: Verifying ingested signals..."
NEW_SIGNAL_COUNT=$(npx ts-node -e "
import { getAllSignals } from './dist/backend/processing/signal_extractor.js';
getAllSignals().then(signals => {
    console.log(signals.length);
    process.exit(0);
}).catch(err => {
    console.log('0');
    process.exit(0);
});
" 2>/dev/null || echo "0")
INGESTED=$((NEW_SIGNAL_COUNT - SIGNAL_COUNT))
echo "   New signals ingested: $INGESTED"
echo "   Total signals: $NEW_SIGNAL_COUNT"
echo ""

# Step 5: Display sample signals
echo "Step 5: Displaying sample ingested signals..."
npx ts-node -e "
import { getSignalsBySource } from './dist/backend/processing/signal_extractor.js';
getSignalsBySource('slack').then(signals => {
    console.log('   Sample signals:');
    signals.slice(0, 3).forEach((sig, i) => {
        console.log(\`   \${i+1}. [\${sig.signal_type}] \${sig.content.substring(0, 60)}...\`);
        console.log(\`      Channel: \${sig.metadata?.channel_name || 'N/A'}\`);
        console.log(\`      Timestamp: \${sig.created_at}\`);
        console.log('');
    });
    process.exit(0);
}).catch(err => {
    console.log('   Could not retrieve signals:', err.message);
    process.exit(0);
});
" 2>/dev/null || echo "   Could not retrieve signals"
echo ""

# Summary
echo "📊 Test Summary"
echo "==============="
echo "   Initial signals: $SIGNAL_COUNT"
echo "   Signals ingested: $INGESTED"
echo "   Total signals: $NEW_SIGNAL_COUNT"
echo ""

if [ "$INGESTED" -gt 0 ]; then
    echo "✅ Test PASSED: Messages successfully ingested!"
else
    echo "⚠️  Test WARNING: No new signals were ingested"
fi
echo ""
