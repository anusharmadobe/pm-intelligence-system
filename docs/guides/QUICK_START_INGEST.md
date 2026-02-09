# Quick Start: Ingest Channel C04D195JVGS

## ✅ Updated: Now Fetches 1000 Messages

All scripts have been updated to fetch up to **1000 messages** from Slack channels.

## 🚀 Simple Method (No Extension Needed)

### Step 1: Run the Ingestion Script

```bash
npm run ingest-channel-c04d195jvgs
```

This script will:
- ✅ Try to access Slack MCP (if available in Cursor IDE terminal)
- ✅ Fetch up to **1000 messages** from channel C04D195JVGS
- ✅ Filter out bots and system messages
- ✅ Ingest as signals into the database
- ✅ Show progress and results

### Step 2: Detect Opportunities

```bash
curl -X POST http://localhost:3000/api/opportunities/detect/incremental
```

Or start the API server first:
```bash
npm start
# Then in another terminal:
curl -X POST http://localhost:3000/api/opportunities/detect/incremental
```

### Step 3: List Opportunities

```bash
npm run list-opps-c04d195jvgs
```

## 📝 Why Extension Commands Don't Appear

The extension commands (`PM Intelligence: Ingest Slack Channel (MCP)`) don't appear because:

1. **Extension not installed**: The extension code exists but isn't installed in Cursor IDE
2. **Cursor extension system**: Cursor may require different installation steps than VS Code
3. **Scripts work independently**: All functionality is available via scripts

## 🔧 Alternative: Manual Ingestion

If MCP isn't available, you can manually ingest via API:

```bash
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{
    "source": "slack",
    "id": "message_ts",
    "type": "message",
    "text": "Your message content here",
    "metadata": {
      "channel_id": "C04D195JVGS"
    }
  }'
```

## 📊 Updated Limits

All scripts now fetch **1000 messages** by default:
- ✅ `scripts/ingest_channel_c04d195jvgs.ts` - 1000 messages
- ✅ `scripts/ingest_and_test_c04d195jvgs.ts` - 1000 messages
- ✅ `scripts/complete_test_c04d195jvgs.ts` - 1000 messages
- ✅ `scripts/test_channel_c04d195jvgs_real.ts` - 1000 messages
- ✅ Extension default (if installed) - 1000 messages

## 🎯 Next Steps

1. Run: `npm run ingest-channel-c04d195jvgs`
2. Check results
3. Detect opportunities
4. List opportunities from channel
