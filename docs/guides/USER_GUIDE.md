# PM Intelligence System - User Guide

## Overview

The PM Intelligence System helps Product Managers improve judgment quality and speed using structured signals and human-in-the-loop LLM assistance. The system follows a 4-layer architecture:

1. **Signals Layer** - Raw, immutable inputs
2. **Opportunities Layer** - Clustered related signals
3. **Judgments Layer** - Human + LLM assisted reasoning
4. **Artifacts Layer** - Generated PRDs, RFCs from judgments

---

## Quick Start

### 1. Setup

```bash
# Install dependencies
npm install

# Set up database
npm run setup-db-auto

# Verify setup
npm run check
```

### 2. Start the API Server

```bash
npm start
# Or for development with auto-reload:
npm run dev
```

The API will be available at `http://localhost:3000`

### 3. Using the Cursor Extension

1. Open Cursor IDE
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "PM Intelligence" to see available commands

---

## Cursor Extension Commands

### Signal Management

**PM Intelligence: Ingest Signal**
- Manually add a signal to the system
- Prompts for: source, type, text content
- Useful for testing or manual entry

**PM Intelligence: View Signals**
- View all ingested signals
- Shows in a new document

**PM Intelligence: List Slack Channels (MCP)**
- Lists available Slack channels (requires Slack MCP setup)
- Select a channel to view details

**PM Intelligence: Ingest Slack Channel (MCP)**
- Ingest messages from a Slack channel
- Requires Slack MCP to be enabled in Cursor

### Opportunity Detection

**PM Intelligence: Detect Opportunities**
- Detects opportunities from existing signals
- Uses incremental detection (only processes new signals)
- Creates opportunities for clusters of 2+ related signals

**PM Intelligence: View Opportunities**
- View all detected opportunities
- Shows title, description, status, and signal count

### Judgment Creation

**PM Intelligence: Create Judgment**
- Create a judgment for an opportunity
- Requires:
  - Selecting an opportunity
  - Your user ID (for human-in-the-loop)
- Uses Cursor's built-in LLM to assist reasoning
- Generates summary, assumptions, and missing evidence

### Artifact Generation

**PM Intelligence: Create Artifact**
- Generate PRD or RFC from a judgment
- Requires:
  - Selecting an opportunity
  - Selecting a judgment
  - Choosing artifact type (PRD or RFC)
  - Your user ID
- Uses Cursor's built-in LLM to generate draft

### Metrics

**PM Intelligence: View Adoption Metrics**
- View system usage metrics
- Shows signals, opportunities, judgments, artifacts counts

---

## API Usage

### Ingest a Signal

```bash
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{
    "source": "slack",
    "type": "message",
    "text": "Customer NFCU wants to expand IC Editor usage"
  }'
```

### Get Signals (with filtering)

```bash
# Get all signals
curl http://localhost:3000/api/signals

# Filter by source
curl "http://localhost:3000/api/signals?source=slack"

# Filter by customer
curl "http://localhost:3000/api/signals?customer=NFCU"

# Pagination
curl "http://localhost:3000/api/signals?limit=10&offset=0"
```

### Detect Opportunities

```bash
# Full detection (re-clusters all signals)
curl -X POST http://localhost:3000/api/opportunities/detect

# Incremental detection (only new signals)
curl -X POST http://localhost:3000/api/opportunities/detect/incremental
```

### Get Opportunities

```bash
# Get all opportunities
curl http://localhost:3000/api/opportunities

# Filter by status
curl "http://localhost:3000/api/opportunities?status=new"

# Pagination
curl "http://localhost:3000/api/opportunities?limit=10&offset=0"
```

### Health Check

```bash
curl http://localhost:3000/health
```

---

## Workflow Examples

### Example 1: Basic Workflow

1. **Ingest Signals**
   ```bash
   # Via API
   curl -X POST http://localhost:3000/api/signals \
     -H "Content-Type: application/json" \
     -d '{"source": "slack", "type": "message", "text": "Customer NFCU meeting notes..."}'
   ```

2. **Detect Opportunities**
   ```bash
   curl -X POST http://localhost:3000/api/opportunities/detect/incremental
   ```

3. **Create Judgment** (via Cursor Extension)
   - Open Cursor IDE
   - Run: "PM Intelligence: Create Judgment"
   - Select opportunity
   - Enter your user ID
   - Review generated judgment

4. **Generate Artifact** (via Cursor Extension)
   - Run: "PM Intelligence: Create Artifact"
   - Select opportunity and judgment
   - Choose PRD or RFC
   - Review generated artifact

### Example 2: Slack Integration

1. **Set up Slack MCP** (in Cursor Settings)
2. **Ingest Channel** (via Cursor Extension)
   - Run: "PM Intelligence: Ingest Slack Channel (MCP)"
   - Select channel
   - Messages are automatically ingested

3. **Detect Opportunities**
   ```bash
   curl -X POST http://localhost:3000/api/opportunities/detect/incremental
   ```

4. **Continue with judgment and artifact creation**

---

## Configuration

### Environment Variables

Create a `.env` file:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pm_intelligence
DB_USER=your_username
DB_PASSWORD=your_password
PORT=3000
LOG_LEVEL=info
```

### Customer/Topic Configuration

Edit `backend/config/entities.ts` to add:
- Customer definitions (with aliases)
- Topic definitions (with keywords and priority)

---

## Troubleshooting

### Database Connection Issues

```bash
# Check database is running
pg_isready

# Verify connection
npm run check
```

### LLM Integration Issues

- Ensure you're running in Cursor IDE (not VS Code)
- Check Cursor version (requires recent version with LLM API)
- Verify LLM provider is accessible

### No Opportunities Detected

- Check signal similarity threshold (default: 0.15)
- Ensure you have at least 2 related signals
- Try adjusting similarity threshold in code

### Rate Limiting

If you hit rate limits:
- Signal ingestion: 50 requests/minute
- Opportunity detection: 10 requests/minute
- General API: 100 requests/15 minutes

Check response headers:
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: When limit resets

---

## Best Practices

1. **Use Incremental Detection**
   - Use `/api/opportunities/detect/incremental` for production
   - Much faster than full re-clustering

2. **Signal Quality**
   - Ensure signals contain meaningful content (10+ characters)
   - Include context in signal text
   - Use consistent source identifiers

3. **Opportunity Review**
   - Review detected opportunities regularly
   - Merge related opportunities if needed
   - Update opportunity status as work progresses

4. **Judgment Quality**
   - Review LLM-generated assumptions
   - Add missing evidence items
   - Update confidence levels based on evidence

5. **Artifact Iteration**
   - Review generated artifacts carefully
   - Edit and refine as needed
   - Use artifacts as starting points, not final documents

---

## Support

For issues or questions:
1. Check logs: `logs/combined.log` and `logs/error.log`
2. Review API documentation: `API.md`
3. Check system health: `curl http://localhost:3000/health`

---

## Next Steps

- See `API.md` for complete API documentation
- See `SETUP_INTEGRATIONS.md` for integration setup
- See `TESTING_GUIDE.md` for testing instructions
