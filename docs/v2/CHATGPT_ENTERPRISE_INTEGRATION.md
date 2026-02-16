## ChatGPT Enterprise Integration

This system can be used with ChatGPT Enterprise via **Actions** (OpenAPI-based tool calls).

### What You Need
- A running PM Intelligence API server (`npm run dev`)
- An Agent Gateway API key
- OpenAPI spec file: `docs/v2/openapi/agent_gateway.json`

### Step 1: Create an Agent Gateway API Key
Register a read-only agent:
```bash
curl -X POST http://localhost:3000/api/agents/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "chatgpt-enterprise",
    "agent_class": "orchestrator",
    "permissions": { "read": true, "write": false, "events": true }
  }'
```
Copy the returned `api_key`. This is shown once.

### Step 2: Add an Action in ChatGPT Enterprise
1. Open ChatGPT Enterprise → **Actions** → **Create New Action**
2. Upload `docs/v2/openapi/agent_gateway.json` or use `http://localhost:3000/openapi/agent_gateway.json`
3. Set the **Base URL** to your PM Intelligence server (e.g., `https://pm-intel.company.com`)
4. Add the API Key:
   - Header name: `X-API-Key`
   - Value: your API key from Step 1

### Step 3: Use It in ChatGPT
Example prompts:
- "Search for signals about checkout latency in the last 30 days."
- "Show a heatmap of issues by customer."
- "Generate a weekly digest for leadership."

### Supported Actions
The OpenAPI spec exposes:
- Signal search
- Knowledge query (`/query`)
- Heatmaps
- Trends
- Opportunities
- Customer profiles
- Provenance
- Source registry (admin)
- Report generation
- Signal ingestion (if write permission enabled)

### Notes
- For **write actions** (ingestion, report generation), register an agent with `write: true`.
- ChatGPT Enterprise Actions do not support SSE. Use `/api/agents/v1/events/history` for polling if needed.
- MCP is still available for Claude Code/Cowork, but ChatGPT Enterprise should use Actions.
