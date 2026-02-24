# PM Intelligence API Documentation

**Version**: 2.0
**Base URL**: `https://api.your-domain.com`
**Last Updated**: 2026-02-24

---

## Authentication

All API requests require authentication using an API key.

### API Key Format
```
pk_{uuid}_{random}
```

### Authentication Header
```http
Authorization: Bearer pk_your_api_key_here
```

### Scopes
- `admin` - Full access to all endpoints
- `read:signals` - Read signals
- `write:signals` - Create/update signals
- `read:opportunities` - Read opportunities
- `write:opportunities` - Create/update opportunities
- `read:analytics` - View analytics
- `export:data` - Export data

---

## Rate Limiting

- **Standard**: 100 requests per minute
- **Webhooks**: 10 requests per minute
- **Export**: 5 requests per minute
- **Admin**: 200 requests per minute

Rate limit headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

---

## Common Response Format

### Success Response
```json
{
  "success": true,
  "data": { /* response data */ }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { /* additional error details */ }
}
```

### HTTP Status Codes
- `200 OK` - Request successful
- `201 Created` - Resource created
- `400 Bad Request` - Invalid request
- `401 Unauthorized` - Missing or invalid API key
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

---

## Signals API

### List Signals
```http
GET /api/signals
```

Query Parameters:
- `limit` (number, optional) - Number of results (default: 50, max: 1000)
- `offset` (number, optional) - Pagination offset (default: 0)
- `source` (string, optional) - Filter by source
- `startDate` (ISO date, optional) - Filter by date range
- `endDate` (ISO date, optional) - Filter by date range

Response:
```json
{
  "success": true,
  "data": {
    "signals": [
      {
        "id": "signal-123",
        "content": "User feedback about feature X",
        "source": "slack",
        "source_id": "msg-456",
        "metadata": {},
        "created_at": "2026-02-24T10:00:00Z"
      }
    ],
    "count": 1,
    "total": 100
  }
}
```

### Create Signal
```http
POST /api/signals
```

Request Body:
```json
{
  "content": "User feedback text",
  "source": "slack",
  "source_id": "msg-123",
  "metadata": {
    "channel": "product-feedback",
    "user": "john@example.com"
  }
}
```

Response: `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "signal-123",
    "content": "User feedback text",
    "created_at": "2026-02-24T10:00:00Z"
  }
}
```

### Get Signal
```http
GET /api/signals/:id
```

Response: `200 OK`

### Export Signals
```http
GET /api/signals/export
```

Query Parameters:
- `format` (string, required) - Export format: `csv`, `json`, `xlsx`
- `columns` (string[], optional) - Columns to include
- `filters` (object, optional) - Filter criteria

Response: File download

---

## Opportunities API

### List Opportunities
```http
GET /api/opportunities
```

Query Parameters:
- `limit` (number) - Results per page
- `offset` (number) - Pagination offset
- `status` (string) - Filter by status: `open`, `closed`, `in_progress`
- `priority` (string) - Filter by priority: `low`, `medium`, `high`

Response:
```json
{
  "success": true,
  "data": {
    "opportunities": [
      {
        "id": "opp-123",
        "title": "Improve search functionality",
        "description": "Users are requesting better search",
        "status": "open",
        "priority": "high",
        "confidence_score": 0.85,
        "signal_count": 12,
        "created_at": "2026-02-24T10:00:00Z"
      }
    ],
    "count": 1,
    "total": 50
  }
}
```

### Create Opportunity
```http
POST /api/opportunities
```

Request Body:
```json
{
  "title": "Feature request",
  "description": "Detailed description",
  "priority": "medium",
  "signal_ids": ["signal-1", "signal-2"]
}
```

Response: `201 Created`

### Update Opportunity
```http
PUT /api/opportunities/:id
```

Request Body:
```json
{
  "status": "in_progress",
  "priority": "high"
}
```

Response: `200 OK`

---

## Admin - Observability API

**Requires**: `admin` scope

### System Health
```http
GET /api/admin/observability/health
```

Query Parameters:
- `hours` (number) - Time window (default: 1)

Response:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-02-24T10:00:00Z",
    "performance": {
      "avgResponseTimeMs": 45,
      "p95ResponseTimeMs": 120,
      "requestCount": 1500,
      "errorRate": 0.01
    },
    "errors": {
      "totalErrors": 5,
      "uniqueErrors": 2,
      "unresolvedErrors": 1
    }
  }
}
```

### Performance Stats
```http
GET /api/admin/observability/performance/stats
```

Query Parameters:
- `module` (string, optional) - Filter by module
- `operation` (string, optional) - Filter by operation
- `hours` (number) - Time window (default: 24)

Response:
```json
{
  "success": true,
  "data": {
    "totalRequests": 50000,
    "avgDurationMs": 45.5,
    "p50DurationMs": 35,
    "p95DurationMs": 120,
    "p99DurationMs": 250,
    "maxDurationMs": 1500,
    "errorCount": 50,
    "errorRate": 0.001
  }
}
```

### Error Statistics
```http
GET /api/admin/observability/errors/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "totalErrors": 150,
    "uniqueErrors": 12,
    "unresolvedErrors": 3,
    "topErrors": [
      {
        "errorType": "ValidationError",
        "module": "signals",
        "occurrenceCount": 45
      }
    ]
  }
}
```

### Export Prometheus Metrics
```http
GET /api/admin/observability/metrics/prometheus
```

Response: `text/plain`
```
# HELP pm_requests_total Total number of requests
# TYPE pm_requests_total counter
pm_requests_total 50000

# HELP pm_request_duration_ms Request duration in milliseconds
# TYPE pm_request_duration_ms summary
pm_request_duration_ms{quantile="0.5"} 35
pm_request_duration_ms{quantile="0.95"} 120
pm_request_duration_ms{quantile="0.99"} 250
```

---

## Admin - Neo4j Management API

**Requires**: `admin` scope

### Get Dead Letter Queue
```http
GET /api/admin/neo4j/dead-letter
```

Query Parameters:
- `limit` (number) - Results limit (default: 100)
- `unresolvedOnly` (boolean) - Show only unresolved (default: true)
- `operation` (string, optional) - Filter by operation

Response:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "dlq-123",
        "operation": "sync_opportunity",
        "retry_count": 5,
        "error_message": "Connection timeout",
        "failed_at": "2026-02-24T09:00:00Z"
      }
    ],
    "count": 1
  }
}
```

### Reprocess Dead Letter Item
```http
POST /api/admin/neo4j/dead-letter/:itemId/reprocess
```

Response: `200 OK`

### Get Backlog Stats
```http
GET /api/admin/neo4j/backlog/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "total": 150,
    "pending": 100,
    "processing": 50,
    "failed": 10,
    "oldest_pending": "2026-02-24T08:00:00Z"
  }
}
```

---

## Data Export API

### Export Data
```http
GET /api/{resource}/export
```

Query Parameters:
- `format` (string, required) - `csv`, `json`, `xlsx`
- `filters` (object, optional) - Filter criteria
- `columns` (string[], optional) - Columns to include

Response: File download with appropriate Content-Type

Examples:
- CSV: `Content-Type: text/csv`
- JSON: `Content-Type: application/json`
- Excel: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

---

## Webhooks

### Slack Webhook
```http
POST /webhooks/slack
```

### Teams Webhook
```http
POST /webhooks/teams
```

### Grafana Webhook
```http
POST /webhooks/grafana
```

---

## Pagination

### Cursor-Based Pagination
```http
GET /api/signals?cursor=eyJpZCI6MTIzfQ==&limit=50
```

Response includes `next_cursor`:
```json
{
  "success": true,
  "data": {
    "items": [...],
    "next_cursor": "eyJpZCI6MTczfQ=="
  }
}
```

### Offset-Based Pagination
```http
GET /api/signals?offset=100&limit=50
```

---

## Filtering & Search

### Advanced Search
```http
POST /api/signals/search
```

Request Body:
```json
{
  "filters": [
    {
      "field": "status",
      "operator": "equals",
      "value": "open"
    },
    {
      "field": "created_at",
      "operator": "gt",
      "value": "2026-01-01T00:00:00Z"
    }
  ],
  "sort": {
    "field": "created_at",
    "order": "desc"
  },
  "limit": 50
}
```

Supported operators:
- `equals`, `contains`, `startsWith`, `endsWith`
- `gt` (>), `lt` (<), `gte` (>=), `lte` (<=)
- `between`, `in`

---

## Error Codes

| Code | Description |
|------|-------------|
| `INVALID_API_KEY` | API key is invalid or expired |
| `INSUFFICIENT_PERMISSIONS` | API key lacks required scope |
| `VALIDATION_ERROR` | Request validation failed |
| `RESOURCE_NOT_FOUND` | Requested resource not found |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `INTERNAL_ERROR` | Internal server error |

---

## Best Practices

### Efficient Pagination
Use cursor-based pagination for large datasets:
```http
GET /api/signals?cursor={cursor}&limit=100
```

### Batch Operations
Use batch endpoints for multiple operations:
```http
POST /api/signals/batch
```

### Caching
Respect cache headers:
```http
Cache-Control: max-age=60
ETag: "abc123"
```

### Idempotency
Use idempotency keys for create operations:
```http
POST /api/signals
Idempotency-Key: unique-key-123
```

---

## SDKs & Tools

### Official SDKs
- Node.js: `npm install @pm-intelligence/sdk`
- Python: `pip install pm-intelligence`

### Example (Node.js)
```javascript
const PMIntelligence = require('@pm-intelligence/sdk');

const client = new PMIntelligence({
  apiKey: 'pk_your_api_key'
});

const signals = await client.signals.list({ limit: 10 });
```

---

## Support

- **Documentation**: https://docs.your-domain.com
- **API Status**: https://status.your-domain.com
- **Support Email**: api-support@your-domain.com
- **Slack Community**: https://slack.your-domain.com

---

*For detailed endpoint specifications, see the OpenAPI/Swagger documentation at `/api/docs`*
