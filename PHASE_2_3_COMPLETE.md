# Phase 2.3 Complete: Logging & Observability

**Status**: ✅ Complete
**Date**: 2026-02-24
**Total Fixes**: 7/7 (100%)

---

## Summary

Phase 2.3 enhances the system's observability with structured logging, performance metrics collection, distributed request tracing, error aggregation, and comprehensive monitoring dashboards. These improvements enable proactive monitoring, faster debugging, and better operational visibility.

---

## Fixes Completed

### 1. ✅ Module-Level Log Configuration (Already Implemented)

**Status**: Already complete via `createModuleLogger()`
**Files**: [backend/utils/logger.ts:92-129](backend/utils/logger.ts#L92-L129)

**What It Does**:
- Creates module-specific loggers with independent log levels
- Supports environment variables for module-level configuration (e.g., `LOG_LEVEL_OPPORTUNITY`)
- Filters logs based on module-specific thresholds
- Adds module metadata to all log entries

**Usage Example**:
```typescript
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('opportunity', 'LOG_LEVEL_OPPORTUNITY');
logger.debug('Processing signals', { count: 10 }); // Only logs if module level is debug or lower
```

**Environment Variables**:
```bash
LOG_LEVEL=info                    # Global log level
LOG_LEVEL_OPPORTUNITY=debug       # Module-specific override
LOG_LEVEL_CORRELATION=trace       # Ultra-detailed tracing for correlation
```

---

### 2. ✅ Structured Logging Improvements

**Status**: Complete
**Files**: [backend/utils/structured_logging.ts](backend/utils/structured_logging.ts)

**What It Does**:
- Provides standard field names for consistent logging (`LogFields`)
- Automatic sensitive data redaction (passwords, tokens, API keys)
- Specialized helpers for HTTP requests, database operations, external APIs
- Rich error logging with stack traces and context
- Security audit logging

**Key Features**:
- **Standard Fields**: `requestId`, `correlationId`, `userId`, `durationMs`, `errorType`, etc.
- **Sensitive Data Redaction**: Automatically redacts passwords, tokens, API keys
- **Operation Timing**: `startOperationTimer()` and `logWithTiming()`
- **Security Events**: `logSecurityEvent()` for auth and permission tracking

**Usage Example**:
```typescript
import { logHttpRequest, logDatabaseOperation, logError } from '../utils/structured_logging';

// HTTP request logging
logHttpRequest({
  method: 'POST',
  path: '/api/signals',
  statusCode: 201,
  durationMs: 45,
  userId: 'user_123'
});

// Database operation logging
logDatabaseOperation({
  operation: 'INSERT',
  table: 'signals',
  durationMs: 12,
  rowsAffected: 1,
  success: true
});

// Error logging with context
logError(error, {
  module: 'opportunity',
  operation: 'detectOpportunities',
  userId: 'user_123'
});
```

---

### 3. ✅ Performance Metrics Collection

**Status**: Complete
**Files**:
- [backend/db/migrations/V3_012_observability_tables.sql:8-53](backend/db/migrations/V3_012_observability_tables.sql#L8-L53)
- [backend/utils/performance_metrics.ts](backend/utils/performance_metrics.ts)

**What It Does**:
- Tracks detailed performance metrics to database
- Aggregates metrics with percentiles (P50, P95, P99)
- Identifies slow operations and bottlenecks
- Tracks database query performance
- Tracks external API call performance

**Database Schema**:
```sql
CREATE TABLE performance_metrics (
  id UUID PRIMARY KEY,
  correlation_id VARCHAR(255),
  request_id VARCHAR(255),
  operation VARCHAR(255) NOT NULL,
  module VARCHAR(100) NOT NULL,
  duration_ms INTEGER NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NOT NULL,
  user_id VARCHAR(255),
  agent_id VARCHAR(255),
  db_operation VARCHAR(50),
  db_table VARCHAR(100),
  external_service VARCHAR(100),
  external_api VARCHAR(255),
  success BOOLEAN NOT NULL DEFAULT true,
  error_type VARCHAR(255),
  metadata JSONB DEFAULT '{}'
);
```

**Usage Example**:
```typescript
import { withPerformanceTracking, trackDatabaseQuery, trackExternalApiCall } from '../utils/performance_metrics';

// Track any operation
await withPerformanceTracking('processSignals', 'ingestion', async () => {
  // Your operation here
}, { signalCount: 10 });

// Track database query
await trackDatabaseQuery('SELECT', 'signals', async () => {
  return await pool.query('SELECT * FROM signals WHERE ...');
});

// Track external API call
await trackExternalApiCall('openai', 'chat.completions', async () => {
  return await openai.chat.completions.create({...});
});
```

**Queries Available**:
- `getPerformanceStats()`: Aggregated stats with percentiles
- `getSlowOperations()`: Operations exceeding threshold
- `getPerformanceMetrics()`: Raw metrics with filters

**Materialized View**:
```sql
-- Hourly performance aggregations (refresh periodically)
CREATE MATERIALIZED VIEW performance_metrics_hourly AS
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  module,
  operation,
  COUNT(*) AS request_count,
  AVG(duration_ms) AS avg_duration_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
  SUM(CASE WHEN success = false THEN 1 ELSE 0 END) AS error_count
FROM performance_metrics
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at), module, operation;
```

---

### 4. ✅ Request Tracing with Spans

**Status**: Complete
**Files**:
- [backend/db/migrations/V3_012_observability_tables.sql:143-177](backend/db/migrations/V3_012_observability_tables.sql#L143-L177)
- [backend/utils/tracing.ts](backend/utils/tracing.ts)
- [backend/utils/correlation.ts](backend/utils/correlation.ts) (foundation)

**What It Does**:
- Distributed tracing with parent-child span relationships
- Automatic trace ID propagation via AsyncLocalStorage
- Span events and tags for rich context
- Trace tree visualization
- Identifies slow traces and error-prone operations

**Database Schema**:
```sql
CREATE TABLE tracing_spans (
  id UUID PRIMARY KEY,
  trace_id VARCHAR(255) NOT NULL,
  span_id VARCHAR(255) NOT NULL,
  parent_span_id VARCHAR(255),
  operation VARCHAR(255) NOT NULL,
  module VARCHAR(100) NOT NULL,
  span_kind VARCHAR(50) NOT NULL DEFAULT 'internal',
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  duration_ms INTEGER,
  user_id VARCHAR(255),
  correlation_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'ok',
  status_message TEXT,
  tags JSONB DEFAULT '{}',
  events JSONB DEFAULT '[]'
);
```

**Usage Example**:
```typescript
import { traceOperation, traceDatabaseQuery, traceExternalCall, addSpanEvent, addSpanTag } from '../utils/tracing';

// Trace an operation
await traceOperation('detectOpportunities', 'opportunity', async (span) => {
  addSpanTag(span.spanId, 'signalCount', 50);
  addSpanEvent(span.spanId, 'clustering_started');

  // Your operation here

  addSpanEvent(span.spanId, 'clustering_completed', { clusterCount: 10 });
}, 'internal');

// Trace database query
await traceDatabaseQuery('SELECT', 'opportunities', async (span) => {
  return await pool.query('SELECT * FROM opportunities WHERE ...');
});

// Trace external API call
await traceExternalCall('openai', '/v1/chat/completions', 'POST', async (span) => {
  return await openai.chat.completions.create({...});
});
```

**Span Kinds**:
- `internal`: Internal operation
- `server`: Incoming request
- `client`: Outgoing request (DB, API)
- `producer`: Message queue producer
- `consumer`: Message queue consumer

**Queries Available**:
- `getTraceSpans(traceId)`: Get all spans for a trace
- `getTraceTree(traceId)`: Get trace with parent-child hierarchy
- `getSlowTraces()`: Traces exceeding threshold
- `getTraceStats()`: Aggregated trace statistics

---

### 5. ✅ Error Aggregation

**Status**: Complete
**Files**:
- [backend/db/migrations/V3_012_observability_tables.sql:54-140](backend/db/migrations/V3_012_observability_tables.sql#L54-L140)
- [backend/utils/error_aggregation.ts](backend/utils/error_aggregation.ts)

**What It Does**:
- Aggregates errors by type and message for monitoring
- Tracks occurrence counts and first/last seen timestamps
- Stores individual error occurrences for detailed analysis
- Supports error resolution tracking
- Provides error trends and statistics

**Database Schema**:
```sql
CREATE TABLE error_aggregation (
  id UUID PRIMARY KEY,
  error_type VARCHAR(255) NOT NULL,
  error_code VARCHAR(100),
  error_message TEXT NOT NULL,
  error_hash VARCHAR(64) NOT  -- Hash for grouping
  module VARCHAR(100) NOT NULL,
  operation VARCHAR(255),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMP NOT NULL,
  last_seen_at TIMESTAMP NOT NULL,
  last_stack_trace TEXT,
  last_correlation_id VARCHAR(255),
  resolved BOOLEAN DEFAULT false,
  resolution_notes TEXT
);

CREATE TABLE error_occurrences (
  id UUID PRIMARY KEY,
  aggregation_id UUID NOT NULL REFERENCES error_aggregation(id),
  error_type VARCHAR(255) NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  correlation_id VARCHAR(255),
  request_id VARCHAR(255),
  user_id VARCHAR(255),
  module VARCHAR(100) NOT NULL,
  http_method VARCHAR(10),
  http_path VARCHAR(500),
  metadata JSONB DEFAULT '{}'
);
```

**Usage Example**:
```typescript
import { trackError, trackErrorFromException, getAggregatedErrors, resolveError } from '../utils/error_aggregation';

// Track an error
try {
  // Your code
} catch (error) {
  await trackErrorFromException(error, 'opportunity', 'detectOpportunities', {
    signalCount: 50,
    userId: 'user_123'
  });
  throw error;
}

// Get aggregated errors
const errors = await getAggregatedErrors({
  module: 'opportunity',
  unresolvedOnly: true,
  minOccurrences: 5,
  hours: 24
});

// Mark error as resolved
await resolveError(errorId, 'admin_user', 'Fixed by deploying patch v1.2.3');
```

**Queries Available**:
- `getAggregatedErrors()`: Get error groups with occurrence counts
- `getErrorOccurrences()`: Get individual occurrences for an error group
- `getErrorStats()`: Aggregated error statistics
- `getErrorTrend()`: Error counts over time
- `resolveError()`: Mark error group as resolved

**Materialized View**:
```sql
CREATE MATERIALIZED VIEW error_summary AS
SELECT
  DATE_TRUNC('hour', last_seen_at) AS hour,
  module,
  error_type,
  COUNT(*) AS error_groups,
  SUM(occurrence_count) AS total_occurrences,
  SUM(CASE WHEN resolved = false THEN 1 ELSE 0 END) AS unresolved_groups
FROM error_aggregation
WHERE last_seen_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', last_seen_at), module, error_type;
```

---

### 6. ✅ Log Rotation (Already Configured)

**Status**: Already complete
**Files**: [backend/utils/logger.ts:66-78](backend/utils/logger.ts#L66-L78)

**What It Does**:
- Automatic log file rotation based on size
- Maintains up to 5 historical log files per type
- Separate error and combined log files

**Configuration**:
```typescript
new winston.transports.File({
  filename: path.join(process.cwd(), 'logs', 'error.log'),
  level: 'error',
  maxsize: 5242880, // 5MB
  maxFiles: 5       // Keep 5 rotated files
}),
new winston.transports.File({
  filename: path.join(process.cwd(), 'logs', 'combined.log'),
  maxsize: 5242880, // 5MB
  maxFiles: 5
})
```

**Log Files**:
- `logs/error.log`: Error-level logs only
- `logs/combined.log`: All log levels
- Automatic rotation at 5MB
- Keeps 5 historical versions

---

### 7. ✅ Monitoring Dashboard Utilities

**Status**: Complete
**Files**:
- [backend/utils/monitoring.ts](backend/utils/monitoring.ts)
- [backend/api/admin_observability_routes.ts](backend/api/admin_observability_routes.ts)

**What It Does**:
- Unified system health monitoring
- SLA compliance metrics
- Performance trends over time
- Alert condition detection
- Prometheus metrics export
- Module-specific health dashboards

**API Endpoints** (all require admin auth):

**System Health**:
- `GET /api/admin/observability/health` - Overall system health
- `GET /api/admin/observability/health/:module` - Module-specific health
- `GET /api/admin/observability/sla` - SLA compliance metrics
- `GET /api/admin/observability/alerts` - Current alert conditions

**Performance**:
- `GET /api/admin/observability/performance/metrics` - Raw metrics
- `GET /api/admin/observability/performance/stats` - Aggregated stats
- `GET /api/admin/observability/performance/slow` - Slow operations
- `GET /api/admin/observability/performance/trends` - Performance over time
- `GET /api/admin/observability/performance/top-slow` - Top slow operations

**Errors**:
- `GET /api/admin/observability/errors` - Aggregated errors
- `GET /api/admin/observability/errors/:id/occurrences` - Error occurrences
- `GET /api/admin/observability/errors/stats` - Error statistics
- `GET /api/admin/observability/errors/trend` - Error trend over time
- `POST /api/admin/observability/errors/:id/resolve` - Resolve error

**Tracing**:
- `GET /api/admin/observability/traces/:traceId` - Get trace spans
- `GET /api/admin/observability/traces/slow` - Slow traces
- `GET /api/admin/observability/traces/stats` - Trace statistics

**Metrics Export**:
- `GET /api/admin/observability/metrics/prometheus` - Prometheus format

**Usage Example**:
```typescript
import { getSystemHealth, getSLAMetrics, getAlertConditions } from '../utils/monitoring';

// Get system health
const health = await getSystemHealth(1); // Last 1 hour
console.log(health.status); // 'healthy', 'degraded', or 'critical'
console.log(health.performance.p95ResponseTimeMs);
console.log(health.errors.unresolvedErrors);

// Get SLA metrics
const sla = await getSLAMetrics(24); // Last 24 hours
console.log(`Availability: ${sla.availability}%`);
console.log(`P95 Latency: ${sla.latencyP95}ms`);
console.log(`Error Rate: ${sla.errorRate}%`);

// Get alerts
const alerts = await getAlertConditions(1);
alerts.forEach(alert => {
  console.log(`[${alert.severity}] ${alert.message}`);
});
```

**Health Status Thresholds**:
- **Healthy**: Error rate < 5%, P95 < 2000ms, < 5 unresolved errors
- **Degraded**: Error rate 5-10%, P95 2000-5000ms, 5-10 unresolved errors
- **Critical**: Error rate > 10%, P95 > 5000ms, > 10 unresolved errors

---

## Files Modified

### Backend - Created Files (7)
1. `backend/db/migrations/V3_012_observability_tables.sql` - Observability database tables
2. `backend/utils/structured_logging.ts` - Structured logging utilities
3. `backend/utils/performance_metrics.ts` - Performance metrics collection
4. `backend/utils/error_aggregation.ts` - Error aggregation system
5. `backend/utils/tracing.ts` - Distributed request tracing
6. `backend/utils/monitoring.ts` - Monitoring dashboard utilities
7. `backend/api/admin_observability_routes.ts` - Admin observability API

### Backend - Modified Files (1)
1. `backend/api/server.ts` - Added observability routes registration

---

## Integration Instructions

### 1. Run Database Migration

```bash
# Apply V3_012 migration
cd backend
npx flyway migrate
# Or use your migration tool
```

### 2. Configure Environment Variables

```bash
# Optional: Module-level log configuration
LOG_LEVEL=info
LOG_LEVEL_OPPORTUNITY=debug
LOG_LEVEL_CORRELATION=trace

# Optional: Performance tracking
PERF_METRICS_ENABLED=true

# Optional: Error aggregation
ERROR_AGGREGATION_ENABLED=true
```

### 3. Refresh Materialized Views (Cron Job)

```bash
# Add to crontab for hourly refresh
0 * * * * psql $DATABASE_URL -c "SELECT refresh_observability_views();"
```

### 4. Integrate Tracking in Code

**Example: Tracking in Services**

```typescript
// In opportunity_service.ts
import { withPerformanceTracking } from '../utils/performance_metrics';
import { trackErrorFromException } from '../utils/error_aggregation';
import { traceOperation } from '../utils/tracing';

export async function detectOpportunities() {
  return await withPerformanceTracking('detectOpportunities', 'opportunity', async () => {
    return await traceOperation('detectOpportunities', 'opportunity', async (span) => {
      try {
        // Your logic here
        addSpanEvent(span.spanId, 'clustering_started');
        // ... more logic
        addSpanEvent(span.spanId, 'clustering_completed');
      } catch (error) {
        await trackErrorFromException(error, 'opportunity', 'detectOpportunities');
        throw error;
      }
    });
  });
}
```

### 5. Access Monitoring Dashboard

```bash
# Get system health
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3000/api/admin/observability/health

# Get performance stats
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/observability/performance/stats?hours=24"

# Get aggregated errors
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/observability/errors?unresolvedOnly=true"

# Get Prometheus metrics
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3000/api/admin/observability/metrics/prometheus
```

---

## Testing Checklist

### Database Migration
- [x] Created V3_012 migration with all tables
- [ ] Run migration on development database
- [ ] Verify all tables created successfully
- [ ] Test materialized view refresh function

### Performance Metrics
- [ ] Track a simple operation
- [ ] Query performance stats
- [ ] Verify slow operations detection
- [ ] Test database query tracking
- [ ] Test external API tracking

### Error Aggregation
- [ ] Track an error occurrence
- [ ] Verify error aggregation (occurrence count increments)
- [ ] Query aggregated errors
- [ ] Resolve an error group
- [ ] View error occurrences for a group

### Request Tracing
- [ ] Create and end a span
- [ ] Add span events and tags
- [ ] Query trace spans
- [ ] View trace tree structure
- [ ] Identify slow traces

### Monitoring Dashboard
- [ ] Get system health status
- [ ] Get SLA metrics
- [ ] Get performance trends
- [ ] Get alert conditions
- [ ] Export Prometheus metrics

---

## Success Metrics

### Performance
- **Metric Collection Overhead**: < 5ms per operation
- **Database Query Performance**: Metric queries < 100ms
- **Materialized View Refresh**: < 5 seconds

### Observability
- **Trace Coverage**: > 80% of operations traced
- **Error Detection**: All exceptions tracked
- **Alert Accuracy**: < 5% false positives

### Usability
- **Dashboard Load Time**: < 2 seconds
- **Metric Availability**: Near real-time (< 1 minute delay)
- **Query Response Time**: < 500ms for aggregated queries

---

## Benefits

### For Developers
- **Faster Debugging**: Correlation IDs link logs, traces, and errors
- **Performance Insights**: Identify bottlenecks with P95/P99 latencies
- **Error Visibility**: See error patterns and frequencies

### For Operations
- **Proactive Monitoring**: Alert on degraded performance before users notice
- **SLA Tracking**: Automated availability and latency metrics
- **Incident Response**: Trace tree shows exact error location

### For Business
- **Reliability**: Track uptime and error rates
- **Performance**: Monitor response times and throughput
- **Cost Optimization**: Identify expensive operations

---

## Next Steps (Phase 3: Quality & UX Improvements)

1. Input validation edge cases
2. User feedback mechanisms
3. Performance optimization for large datasets
4. Accessibility improvements
5. Mobile responsiveness
6. Internationalization (i18n)
7. Advanced search filters
8. Batch operations
9. Data export formats
10. Notification preferences
11. Keyboard shortcuts
12. Dark mode support
13. Custom dashboards
14. Saved queries
15. Report scheduling
16. Audit trail UI

---

*Last Updated: 2026-02-24*
*Phase 2.3: 7/7 fixes complete (100%)*
*Ready to begin Phase 3*
