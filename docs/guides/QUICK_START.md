# Quick Start Guide

## Step 1: Database Setup

First, let's set up PostgreSQL:

```bash
# Check if PostgreSQL is installed
psql --version

# If not installed, install it:
# macOS: brew install postgresql
# Ubuntu: sudo apt-get install postgresql
# Windows: Download from postgresql.org

# Start PostgreSQL service
# macOS: brew services start postgresql
# Linux: sudo systemctl start postgresql

# Create database
createdb pm_intelligence
```

## Step 2: Run Setup Script

```bash
npm run setup
```

The script will:
1. Check prerequisites
2. Install npm dependencies
3. Ask for database credentials
4. Create database if needed
5. Run migrations
6. Create `.env` file
7. Build the project

## Step 3: Verify Setup

```bash
npm run check
```

This verifies:
- ✅ Database connection
- ✅ Tables exist
- ✅ Indexes created
- ✅ Environment variables set

## Step 4: Start API Server

```bash
npm start
```

You should see:
```
Database connection established
PM Intelligence API server running on 0.0.0.0:3000
Health check: http://localhost:3000/health
```

Test it:
```bash
curl http://localhost:3000/health
```

## Step 5: Seed Sample Data (Optional)

```bash
npm run seed
```

This creates sample signals and opportunities for testing.

## Step 6: Configure Integrations

### For Slack MCP (Cursor Integration)

If you're using Cursor with Slack MCP:

1. **Check if Slack MCP is enabled in Cursor:**
   - Open Cursor Settings
   - Look for "MCP" or "Model Context Protocol"
   - Check if Slack is listed

2. **Create a helper script** (we can do this together):
   - Ask me: "Create a script that uses Cursor's Slack MCP to ingest messages into PM Intelligence"

### For Slack Webhook

1. Go to https://api.slack.com/apps
2. Create new app → "From scratch"
3. Enable "Event Subscriptions"
4. Set Request URL: `http://your-server:3000/webhooks/slack`
5. Subscribe to `message.channels` and `app_mentions`
6. Install app to workspace

See [SETUP_INTEGRATIONS.md](./SETUP_INTEGRATIONS.md) for full details.

## Step 7: Use Cursor Extension

1. **Open Cursor IDE**
2. **Open Command Palette** (Cmd+Shift+P / Ctrl+Shift+P)
3. **Try these commands:**
   - `PM Intelligence: Ingest Signal`
   - `PM Intelligence: View Signals`
   - `PM Intelligence: Detect Opportunities`
   - `PM Intelligence: Create Judgment`
   - `PM Intelligence: View Metrics`

## Troubleshooting

### Database Connection Failed
```bash
# Check PostgreSQL is running
psql -U postgres -c "SELECT 1"

# Check .env file exists and has correct values
cat .env
```

### Migration Failed
```bash
# Drop and recreate database
dropdb pm_intelligence
createdb pm_intelligence
npm run migrate
```

### API Server Won't Start
```bash
# Check if port 3000 is in use
lsof -i :3000

# Use different port
export PORT=3001
npm start
```

## Next Steps

1. ✅ Database setup complete
2. ✅ API server running
3. ⏭️ Configure integrations (Slack MCP, webhooks)
4. ⏭️ Start ingesting signals
5. ⏭️ Create judgments and artifacts

**Need help?** Ask me:
- "Help me set up Slack MCP integration"
- "Create a script to ingest Slack messages via MCP"
- "Test the API endpoints"
- "Show me how to use the Cursor extension"
