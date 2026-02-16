# PM Intelligence V2 — End-to-End Test Cases
> **Last Updated:** 2026-02-11

## Prerequisites
- `docker compose up -d`
- `npm run migrate`
- `npm run dev` (API on `http://localhost:3000`)
- Optional: Python services on ports 5001/5002 if you want full health.
- Ensure `FF_AGENT_GATEWAY=true` and `FF_A2A_SERVER=true` in `.env`.

## Test Cases

### E2E-01 — Register Agent
**Steps**
1. `POST /api/agents/v1/auth/register`
2. Provide `agent_name`, `agent_class`, and permissions.

**Expected**
- `200 OK`
- Response contains `api_key` and `agent`.

### E2E-02 — Agent Gateway Health
**Steps**
1. `GET /api/agents/v1/health` (public; `X-API-Key` optional)

**Expected**
- `200 OK`
- Response `status = ok`.

### E2E-03 — Ingest Signal (Idempotent)
**Steps**
1. `POST /api/agents/v1/ingest` with `Idempotency-Key: e2e-xyz`
2. Repeat the same request with the same idempotency key.

**Expected**
- First request returns `201` with `signal_id`.
- Second request returns `200` and same `signal_id` with `idempotent: true`.

### E2E-04 — Knowledge Query
**Steps**
1. `POST /api/agents/v1/query` with `{ "query": "checkout latency" }`

**Expected**
- `200 OK`
- Response includes `answer` and `supporting_signals`.

### E2E-05 — Source Registry
**Steps**
1. `POST /api/agents/v1/sources` with `source_name`, `source_type`
2. `GET /api/agents/v1/sources`

**Expected**
- `201 Created` on registration
- List response includes registered source

### E2E-06 — Customer Profile
**Steps**
1. `GET /api/agents/v1/customer/Acme%20Corp`

**Expected**
- `200 OK`
- Response includes `signal_count`, `top_features`, `top_issues`.

### E2E-07 — Heatmap
**Steps**
1. `GET /api/agents/v1/heatmap?dimension=issues_by_customer&limit=5`

**Expected**
- `200 OK`
- Response contains `rows` array with `{ x, y, value }`.

### E2E-08 — Trends
**Steps**
1. `GET /api/agents/v1/trends?entity_type=issue&window_days=28`

**Expected**
- `200 OK`
- Response includes `trends`.

### E2E-09 — Opportunities
**Steps**
1. `GET /api/agents/v1/opportunities`

**Expected**
- `200 OK`
- Response includes `opportunities`.

### E2E-10 — System Health
**Steps**
1. `GET /api/health`

**Expected**
- `200 OK` or `503 Degraded` (with component details).

### E2E-11 — A2A Query
**Steps**
1. `POST /a2a` with JSON-RPC `message/send` using `skill_id=query-trends`

**Expected**
- JSON-RPC result with `task.status.state = completed`.

### E2E-12 — Web UI Loads
**Steps**
1. Open `http://localhost:3000/ui`

**Expected**
- UI renders with persona tabs and API key input.

## Automation
Automated coverage is provided by `scripts/test_end_to_end_v2.ts` and should be run after any major infrastructure change.
# End-to-End Test Cases (V2)

## Scope
These test cases validate the full PM Intelligence V2 pipeline across ingestion, extraction, entity resolution, agent access, and UI.

## Preconditions
- Docker services running: PostgreSQL, Neo4j, Redis
- Python services running: entity resolution, document parser
- Node app running on `http://localhost:3000`
- Feature flags enabled: `FF_AGENT_GATEWAY`, `FF_A2A_SERVER`, `FF_EVENT_BUS`

---

## TC-01: Agent Gateway Health
**Steps**
1. Register an agent via `POST /api/agents/v1/auth/register`
2. Call `GET /api/agents/v1/health`

**Expected**
- HTTP 200
- `status: ok`

---

## TC-02: Ingest Signal (Manual)
**Steps**
1. Register an agent with `write: true`
2. Call `POST /api/agents/v1/ingest` with sample content

**Expected**
- HTTP 201
- `signal_id` returned

---

## TC-03: Customer Profile
**Steps**
1. Call `GET /api/agents/v1/customer/{name}`

**Expected**
- HTTP 200
- Profile contains `signals`, `issues`, or `features`

---

## TC-04: Heatmap
**Steps**
1. Call `GET /api/agents/v1/heatmap?dimension=issues_by_customer&limit=5`

**Expected**
- HTTP 200
- `rows` array present

---

## TC-05: Trends
**Steps**
1. Call `GET /api/agents/v1/trends?entity_type=issue&window_days=28`

**Expected**
- HTTP 200
- `trends` array present

---

## TC-06: A2A Query
**Steps**
1. Call `POST /a2a` with `message/send` and `skill_id: query-trends`

**Expected**
- HTTP 200
- JSON-RPC `result.task.status.state = "completed"`

---

## TC-07: UI Load
**Steps**
1. Open `http://localhost:3000/ui`

**Expected**
- UI renders tabs and panels
- No console errors

---

## TC-08: Events History
**Steps**
1. Call `GET /api/agents/v1/events/history`

**Expected**
- HTTP 200
- `events` array present (may be empty)

---

## Automation
Run the automated script:
```bash
npx ts-node scripts/test_end_to_end_v2.ts
```
