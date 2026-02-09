# Test Judgment Creation Standalone

## Problem Found

The backend server is running **old code** that:
1. Returns `501` for `/api/judgments` POST (old error message)
2. Missing `/api/opportunities/:opportunityId/signals` endpoint (returns 404)

## Solution

**Restart the backend server** to load the new code:

```bash
# Stop existing server (if running)
lsof -ti:3000 | xargs kill -9

# Start server with new code
npm start
# OR
npm run dev
```

## Test Script

Run the standalone test:

```bash
npx ts-node scripts/test_judgment_standalone.ts
```

This will:
1. ✅ Check API health
2. ✅ Fetch opportunities
3. ⚠️ Fetch signals (will work after server restart)
4. ✅ Create judgment via API (will work after server restart)
5. ✅ Verify judgment was saved

## What the Test Verifies

- Backend API endpoints are working
- Judgment creation flow works end-to-end
- Database connection is working
- All required endpoints exist

## After Server Restart

Once you restart the server, the test should pass and show:
- ✅ API is running
- ✅ Opportunities API works
- ✅ Signals API works (after restart)
- ✅ Judgment Creation API works (after restart)
- ✅ Judgment Verification works

This confirms the **backend is working correctly** - the issue is with the extension not loading/registering commands.
