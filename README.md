# PM Intelligence System

PM Intelligence System for structured signals, opportunity detection, and roadmap insights.

Note: The Cursor extension is archived at `backup/cursor_extension/` and is not active.

## V2 Overview

V2 adds a full context layer for PM workflows:

- **Ingestion adapters** (Slack, transcripts, documents, web scrape)
- **LLM extraction** with validation + hallucination guards
- **Entity resolution** with human feedback loops
- **Knowledge graph sync** (PostgreSQL as source of truth, Neo4j mirror)
- **Agent Gateway** for ChatGPT Enterprise Actions and external agents
- **MCP server** for Claude Code/Cowork tool access (optional)
- **Web UI** at `/ui`
- **Agent Gateway + A2A server** for external agent interactions
- **Python microservices** for document parsing and GraphRAG indexing

## Architecture

The system follows a strict 4-layer architecture:

1. **Signals Layer** - Raw, immutable inputs (Slack, Teams, Grafana, Splunk)
2. **Opportunities Layer** - Clusters related signals (no inference)
3. **Judgments Layer** - Human + LLM assisted reasoning
4. **Artifacts Layer** - Generates PRDs, RFCs from judgments

Flow: `signals → opportunities → judgments → artifacts`

## Design Principles

- Signals are immutable and never contain summaries/insights
- LLMs only allowed in judgments and artifacts layers
- Human-in-the-loop required for judgments
- Judgments are append-only (no overwrites)
- No autonomous decisions

## V2 Quick Start

1. **Start infrastructure**
   ```bash
   docker compose up -d
   ```

2. **Python services**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn python.document_parser.main:app --port 5002
   uvicorn python.graphrag_indexer.main:app --port 5003
   ```

3. **Install + migrate**
   ```bash
   npm install
   npm run migrate
   npm run build
   ```

4. **Start API server**
   ```bash
   npm run dev
   ```

5. **Start MCP server (Cursor/Claude tools, optional)**
   ```bash
   npx ts-node backend/mcp/server.ts
   ```

6. **Agent Gateway + A2A**
   - Agent Gateway: `http://localhost:3000/api/agents/v1`
   - A2A Agent Card: `http://localhost:3000/.well-known/agent.json`

## Quick Start

### Automated Setup (Recommended)

Run the interactive setup script:

```bash
npm run setup
```

This will:
- Check prerequisites
- Install dependencies
- Set up database (with prompts for credentials)
- Run migrations
- Create `.env` file
- Build the project
- Optionally seed sample data

### Manual Setup

1. **Prerequisites:**
   - Node.js 18+
   - PostgreSQL 12+
   - Cursor IDE

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up database:**
   ```bash
   # Create database
   createdb pm_intelligence
   
   # Set environment variables
   export DB_HOST=localhost
   export DB_PORT=5432
   export DB_NAME=pm_intelligence
   export DB_USER=postgres
   export DB_PASSWORD=your_password
   ```

4. **Run migrations:**
   ```bash
   npm run migrate
   ```

5. **Verify setup:**
   ```bash
   npm run check
   ```

6. **Start API server:**
   ```bash
   npm start
   # Or for development:
   npm run dev
   ```

7. **Seed sample data (optional):**
   ```bash
   npm run seed
   ```

## Setup Integrations

After basic setup, configure integrations:

📖 **See [SETUP_INTEGRATIONS.md](./docs/guides/SETUP_INTEGRATIONS.md) for detailed instructions**

Quick summary:
- **Slack:** Webhook URL or Slack MCP integration
- **Teams:** Webhook configuration
- **Grafana:** Alert notification channel
- **Splunk:** Webhook alert action

## Slack-Only Deployment

If you are running a Slack-only implementation (no other signal sources), see:
**[SLACK_ONLY_ARCHITECTURE.md](./docs/analysis/SLACK_ONLY_ARCHITECTURE.md)** for the
Slack-specific ingestion, extraction, storage, and query design.

## Usage

### Cursor Extension Commands (Archived)

The extension is archived in `backup/cursor_extension/`. These commands are not available right now:

- **PM Intelligence: Ingest Signal** - Add a raw signal to the system
- **PM Intelligence: Detect Opportunities** - Cluster signals into opportunities
- **PM Intelligence: Create Judgment** - Create a judgment with LLM assistance
- **PM Intelligence: Create Artifact** - Generate PRD or RFC from a judgment
- **PM Intelligence: View Signals** - View all ingested signals
- **PM Intelligence: View Opportunities** - View detected opportunities
- **PM Intelligence: View Adoption Metrics** - View system usage metrics

### REST API

The system includes a REST API for external integrations. See [API.md](./docs/guides/API.md) for full documentation.

**Quick Start:**
```bash
# Ingest a signal
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -d '{"source": "slack", "text": "User reported issue", "type": "message"}'

# Detect opportunities
curl -X POST http://localhost:3000/api/opportunities/detect

# Get metrics
curl http://localhost:3000/api/metrics
```

### Webhooks

Configure webhooks for automatic signal ingestion:

- **Slack**: `POST /webhooks/slack`
- **Teams**: `POST /webhooks/teams`
- **Grafana**: `POST /webhooks/grafana`
- **Splunk**: `POST /webhooks/splunk`

See [API.md](./docs/guides/API.md) for webhook payload formats.

### Workflow

1. **Ingest Signals**: Collect raw signals from various sources (via API or webhooks)
2. **Detect Opportunities**: Automatically cluster related signals
3. **Create Judgments**: Use LLM to assist reasoning (human-in-the-loop required)
4. **Generate Artifacts**: Create PRDs or RFCs from judgments

## Database Schema

The system uses the following tables (see `specs/sql_schema.sql`):

- `signals` - Raw signal data
- `opportunities` - Clustered opportunities
- `opportunity_signals` - Many-to-many relationship
- `judgments` - Human+LLM reasoning
- `artifacts` - Generated documents

## Constraints

- All files under `/specs` are immutable contracts
- Do not introduce new entities, layers, or goals
- Do not merge layers
- Do not invoke LLMs outside Judgment or Artifact layers
- Signals are immutable
- Judgments are append-only

## Non-Goals

This system will NOT:
- Decide product priorities
- Generate roadmaps automatically
- Replace PM judgment
- Predict success

This system EXISTS to:
- Surface signals
- Structure thinking
- Improve decision quality

## Development

### Project Structure

```
├── backend/
│   ├── api/             # REST API server and endpoints
│   ├── config/          # Environment configuration
│   ├── db/              # Database connection and migrations
│   ├── integrations/    # Signal source adapters (Slack, Teams, Grafana, Splunk)
│   ├── processing/     # Signal extraction (no LLMs)
│   ├── services/       # Business logic (judgments, artifacts use LLMs)
│   ├── tests/          # Test utilities and sample data
│   └── validation/     # Input validation
├── backup/cursor_extension/    # Archived Cursor IDE extension
└── specs/              # Immutable contracts (DO NOT MODIFY)
```

## Docs

- V2 specs: `specs/v2/`
- User and developer guides: `docs/v2/`
- Architecture notes: `docs/analysis/`

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

## License

[Your License Here]
