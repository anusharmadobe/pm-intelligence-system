# Cost Tracking API Documentation

## Overview

The Cost Tracking API provides comprehensive endpoints for monitoring LLM and embedding costs, managing agent budgets, and analyzing spending patterns.

**Base URL**: `http://localhost:3000/api`

---

## Public Cost Query Endpoints

### 1. GET /api/cost/dashboard
Get comprehensive dashboard data including current month costs, today's costs, top agents, and top models.

**Response**:
```json
{
  "success": true,
  "data": {
    "current_month": {
      "total_cost": 42.75,
      "month": "2026-02"
    },
    "today": {
      "total_cost": 1.23,
      "date": "2026-02-20"
    },
    "top_agents": [
      {
        "agent_name": "signal-processor",
        "cost_usd": 28.30,
        "operation_count": 1234
      }
    ],
    "top_models": [
      {
        "provider": "openai",
        "model": "gpt-4o",
        "cost_usd": 35.20,
        "operation_count": 856
      }
    ]
  }
}
```

**UI Component**: Dashboard Overview Card

---

### 2. GET /api/cost/summary
Get aggregated cost summary with optional filtering.

**Query Parameters**:
- `agent_id` (optional): Filter by specific agent
- `signal_id` (optional): Filter by specific signal
- `date_from` (optional): Start date (ISO format)
- `date_to` (optional): End date (ISO format)
- `group_by` (optional): Grouping (`day`, `week`, `month`)

**Example Request**:
```http
GET /api/cost/summary?date_from=2026-02-01&date_to=2026-02-20&group_by=day
```

**Response**:
```json
{
  "success": true,
  "data": {
    "summary": {
      "total_cost_usd": 42.75,
      "total_operations": 5432,
      "total_input_tokens": 123456,
      "total_output_tokens": 45678,
      "by_operation": {
        "llm_extraction": 28.50,
        "embedding": 4.25,
        "synthesis": 10.00
      },
      "by_model": {
        "gpt-4o": 35.20,
        "gpt-4o-mini": 3.30,
        "text-embedding-3-large": 4.25
      },
      "period_start": "2026-02-01T00:00:00Z",
      "period_end": "2026-02-20T23:59:59Z"
    },
    "trend": [
      {
        "period": "2026-02-01T00:00:00Z",
        "cost_usd": 2.15,
        "operation_count": 287,
        "total_tokens": 12345
      }
    ]
  }
}
```

**UI Components**:
- Cost breakdown pie chart (by operation/model)
- Trend line chart

---

### 3. GET /api/cost/agents
Get cost summary for all agents.

**Query Parameters**:
- `month` (optional): Target month (YYYY-MM format, defaults to current month)

**Example Request**:
```http
GET /api/cost/agents?month=2026-02
```

**Response**:
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "agent_id": "uuid-123",
        "agent_name": "signal-processor",
        "budget_limit": 50.00,
        "current_cost": 28.30,
        "remaining": 21.70,
        "utilization_pct": 56.60,
        "operation_count": 1234,
        "total_input_tokens": 45678,
        "total_output_tokens": 12345,
        "is_active": true,
        "cost_reset_at": "2026-03-01T00:00:00Z"
      }
    ],
    "month": "2026-02"
  }
}
```

**UI Components**:
- Agent cost table with budget utilization bars
- Budget alert badges (red if >90%, yellow if >75%)

---

### 4. GET /api/cost/models
Get cost breakdown by model.

**Query Parameters**:
- `date_from` (optional): Start date (defaults to current month start)
- `date_to` (optional): End date (defaults to now)

**Example Request**:
```http
GET /api/cost/models?date_from=2026-02-01
```

**Response**:
```json
{
  "success": true,
  "data": {
    "models": [
      {
        "provider": "openai",
        "model": "gpt-4o",
        "total_input_tokens": 85234,
        "total_output_tokens": 23456,
        "total_cost_usd": 35.20,
        "operation_count": 856,
        "avg_response_time_ms": 1234.5,
        "first_use": "2026-02-01T10:30:00Z",
        "last_use": "2026-02-20T15:45:00Z"
      }
    ],
    "period": {
      "from": "2026-02-01T00:00:00Z",
      "to": "2026-02-20T23:59:59Z"
    }
  }
}
```

**UI Components**:
- Model comparison table
- Cost per model bar chart

---

### 5. GET /api/cost/operations
Get cost breakdown by operation type.

**Query Parameters**:
- `date_from` (optional): Start date (defaults to current month start)
- `date_to` (optional): End date (defaults to now)

**Response**:
```json
{
  "success": true,
  "data": {
    "operations": [
      {
        "operation": "llm_extraction",
        "total_input_tokens": 75234,
        "total_output_tokens": 18456,
        "total_cost_usd": 28.50,
        "operation_count": 2345,
        "avg_cost_per_operation": 0.01215,
        "avg_response_time_ms": 1567.8
      }
    ],
    "period": {
      "from": "2026-02-01T00:00:00Z",
      "to": "2026-02-20T23:59:59Z"
    }
  }
}
```

**UI Components**:
- Operation type breakdown chart
- Average cost per operation metrics

---

### 6. GET /api/cost/trends
Get cost trends with monthly projection.

**Query Parameters**:
- `days` (optional): Number of days to include (default: 30)

**Response**:
```json
{
  "success": true,
  "data": {
    "daily_trend": [
      {
        "day": "2026-02-01T00:00:00Z",
        "cost_usd": 2.15,
        "operation_count": 287,
        "total_tokens": 12345
      }
    ],
    "projection": {
      "month_to_date_cost": 38.50,
      "avg_daily_cost": 1.93,
      "projected_monthly_cost": 54.25,
      "days_remaining": 10,
      "confidence": "high"
    }
  }
}
```

**UI Components**:
- Daily cost trend line chart
- Projected monthly cost card with confidence indicator
- Days remaining progress bar

---

## Admin Cost Management Endpoints

**Note**: All admin endpoints require admin authentication via `requireAdmin` middleware.

### 7. GET /api/admin/agents/:agentId/cost
Get detailed cost information for a specific agent.

**Response**:
```json
{
  "success": true,
  "data": {
    "agent_id": "uuid-123",
    "budget": {
      "allowed": true,
      "remaining": 21.70,
      "limit": 50.00,
      "current_cost": 28.30,
      "utilization_pct": 56.60
    },
    "current_month": {
      "total_cost_usd": 28.30,
      "total_operations": 1234,
      "total_input_tokens": 45678,
      "total_output_tokens": 12345,
      "by_operation": {...},
      "by_model": {...},
      "period_start": "2026-02-01T00:00:00Z",
      "period_end": "2026-02-20T23:59:59Z"
    }
  }
}
```

---

### 8. POST /api/admin/agents/:agentId/budget
Update agent budget limit.

**Request Body**:
```json
{
  "max_monthly_cost_usd": 100.00
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "agent_id": "uuid-123",
    "max_monthly_cost_usd": 100.00
  }
}
```

---

### 9. POST /api/admin/agents/:agentId/budget/reset
Reset agent monthly cost counter.

**Response**:
```json
{
  "success": true,
  "data": {
    "agent_id": "uuid-123",
    "message": "Monthly cost counter reset successfully"
  }
}
```

---

### 10. POST /api/admin/agents/:agentId/unpause
Unpause an agent that was auto-paused due to budget.

**Response**:
```json
{
  "success": true,
  "data": {
    "agent_id": "uuid-123",
    "message": "Agent unpaused successfully"
  }
}
```

---

### 11. POST /api/admin/agents/:agentId/pause
Manually pause an agent.

**Request Body**:
```json
{
  "reason": "manual_maintenance"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "agent_id": "uuid-123",
    "message": "Agent paused successfully"
  }
}
```

---

## UI Component Examples

### Dashboard Overview
```typescript
// Example React component
import { useEffect, useState } from 'react';

function CostDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/cost/dashboard')
      .then(res => res.json())
      .then(data => setData(data.data));
  }, []);

  if (!data) return <div>Loading...</div>;

  return (
    <div className="dashboard">
      <div className="metric-card">
        <h3>This Month</h3>
        <div className="cost">${data.current_month.total_cost.toFixed(2)}</div>
      </div>
      <div className="metric-card">
        <h3>Today</h3>
        <div className="cost">${data.today.total_cost.toFixed(2)}</div>
      </div>
      {/* Top agents table */}
      {/* Top models chart */}
    </div>
  );
}
```

### Agent Budget Monitor
```typescript
function AgentBudgetMonitor() {
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    fetch('/api/cost/agents')
      .then(res => res.json())
      .then(data => setAgents(data.data.agents));
  }, []);

  return (
    <table className="agents-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Budget</th>
          <th>Used</th>
          <th>Utilization</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {agents.map(agent => (
          <tr key={agent.agent_id}>
            <td>{agent.agent_name}</td>
            <td>${agent.budget_limit.toFixed(2)}</td>
            <td>${agent.current_cost.toFixed(2)}</td>
            <td>
              <div className="progress-bar">
                <div
                  className={`progress ${agent.utilization_pct > 90 ? 'danger' : agent.utilization_pct > 75 ? 'warning' : 'normal'}`}
                  style={{ width: `${agent.utilization_pct}%` }}
                />
              </div>
              <span>{agent.utilization_pct.toFixed(1)}%</span>
            </td>
            <td>
              <span className={`status ${agent.is_active ? 'active' : 'paused'}`}>
                {agent.is_active ? 'Active' : 'Paused'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### Cost Trend Chart
```typescript
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts';

function CostTrendChart({ days = 30 }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`/api/cost/trends?days=${days}`)
      .then(res => res.json())
      .then(data => setData(data.data));
  }, [days]);

  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <h3>Cost Trend</h3>
      <LineChart width={800} height={400} data={data.daily_trend}>
        <XAxis dataKey="day" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="cost_usd" stroke="#8884d8" name="Daily Cost (USD)" />
      </LineChart>

      <div className="projection-card">
        <h4>Projected Monthly Cost</h4>
        <div className="projected-cost">${data.projection.projected_monthly_cost.toFixed(2)}</div>
        <div className="confidence">Confidence: {data.projection.confidence}</div>
        <div className="days-remaining">{data.projection.days_remaining} days remaining</div>
      </div>
    </div>
  );
}
```

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message description"
}
```

**Common HTTP Status Codes**:
- `200`: Success
- `400`: Bad request (invalid parameters)
- `401`: Unauthorized (missing or invalid API key)
- `403`: Forbidden (insufficient permissions)
- `429`: Too many requests (rate limit exceeded)
- `500`: Internal server error

---

## Rate Limiting

Cost API endpoints are subject to rate limiting:
- **General API**: 100 requests per 15 minutes
- **Admin endpoints**: Same as general API (requires admin auth)

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1645390800
```

---

## Authentication

**Public endpoints** (`/api/cost/*`): Require valid API key in header:
```
Authorization: Bearer your-api-key-here
```

**Admin endpoints** (`/api/admin/*`): Require API key with admin permissions.

---

## Next Steps

1. **Run Database Migration**: `npm run migrate` to create cost tracking tables
2. **Enable Cost Tracking**: Set `FF_COST_TRACKING=true` in `.env`
3. **Set Pricing Tier**: Set `COST_TRACKING_TIER=production` (or `development` for testing)
4. **Build UI Components**: Use the endpoints above to create cost dashboards
5. **Set Agent Budgets**: Use admin endpoints to configure budget limits
6. **Monitor Costs**: Set up alerts for budget thresholds

---

## Support

For issues or questions:
- Check logs: `tail -f logs/app.log | grep cost`
- Verify database: `psql -c "SELECT COUNT(*) FROM llm_cost_log;"`
- Test endpoints: Use Postman or `curl` with examples above
