# Configurable Logging Guide

## Overview

The PM Intelligence System supports module-specific log level configuration, allowing you to debug individual components without affecting the entire system.

## Global Configuration

Set the baseline log level for all modules:

```bash
LOG_LEVEL=info  # Options: error, warn, info, debug, trace
```

## Module-Specific Configuration

Override the global level for specific modules:

### Infrastructure & Utilities

- `LOG_LEVEL_CORRELATION` - Correlation ID middleware and context propagation
- `LOG_LEVEL_CACHE` - LRU cache operations (hit/miss, evictions)
- `LOG_LEVEL_RETRY` - Retry logic and circuit breaker state
- `LOG_LEVEL_REDIS` - Redis connection management
- `LOG_LEVEL_HEALTH` - Health check endpoints

### Services

- `LOG_LEVEL_FAILED_SIGNAL_RETRY` - Failed signal retry mechanism
- `LOG_LEVEL_FILE_VALIDATION` - File upload validation
- `LOG_LEVEL_WEBSITE_CRAWLER` - Website crawling operations
- `LOG_LEVEL_OPPORTUNITY` - Opportunity detection
- `LOG_LEVEL_ENTITY_RESOLUTION` - Entity resolution
- `LOG_LEVEL_HYBRID_SEARCH` - Hybrid search operations

## Security Audit Logs

The following security events are ALWAYS logged at INFO level (not configurable):

- Authentication successes/failures
- Permission checks (granted/denied)
- Admin access grants
- API key usage
- Webhook signature verifications
- File upload/deletion events
- Admin operations (ingestion, etc.)

These logs are marked with `security_event` or `audit: true` for easy filtering.

## Performance Recommendations

### Production (Baseline)
```bash
LOG_LEVEL=info
```

### Debug Single Module
```bash
LOG_LEVEL=info
LOG_LEVEL_CACHE=debug  # Debug just the cache
```

### Deep Troubleshooting
```bash
LOG_LEVEL=info
LOG_LEVEL_RETRY=trace
LOG_LEVEL_REDIS=debug
LOG_LEVEL_CORRELATION=debug
```

### Development
```bash
LOG_LEVEL=debug  # More verbose baseline
```

## Log Filtering Examples

### View security audit logs only:
```bash
tail -f logs/combined.log | jq 'select(.security_event != null)'
```

### View logs for specific module:
```bash
tail -f logs/combined.log | jq 'select(.module == "cache")'
```

### View slow operations:
```bash
tail -f logs/combined.log | jq 'select(.duration_ms > 1000)'
```

### View authentication events:
```bash
tail -f logs/combined.log | jq 'select(.security_event == "auth_success")'
```

### View admin operations:
```bash
tail -f logs/combined.log | jq 'select(.audit == true)'
```

### View failed operations:
```bash
tail -f logs/combined.log | jq 'select(.level == "error")'
```

## Common Debugging Scenarios

### Scenario: Cache Performance Issues

**Symptoms**: Slow response times, high memory usage

**Solution**:
```bash
LOG_LEVEL_CACHE=debug
LOG_LEVEL_ENTITY_RESOLUTION=debug
```

**What to look for**:
- Low cache hit rates (`hit_rate < 0.5`)
- High eviction frequency
- Large cache sizes approaching max capacity

### Scenario: Authentication Failures

**Symptoms**: Users can't log in, API requests failing

**Solution**: Security audit logs are already at INFO level

**What to look for**:
```bash
tail -f logs/combined.log | jq 'select(.security_event | startswith("auth"))'
```
- Failed auth attempts with invalid credentials
- Missing or expired API keys
- Permission denied events

### Scenario: Retry Logic Not Working

**Symptoms**: Operations failing without retries, circuit breaker stuck open

**Solution**:
```bash
LOG_LEVEL_RETRY=trace
LOG_LEVEL_FAILED_SIGNAL_RETRY=debug
```

**What to look for**:
- Non-retryable errors being thrown immediately
- Circuit breaker state transitions
- Exponential backoff delays
- Retry attempt counts

### Scenario: File Upload Failures

**Symptoms**: Files rejected, validation errors

**Solution**:
```bash
LOG_LEVEL_FILE_VALIDATION=debug
```

**What to look for**:
- Which validation step is failing (filename, extension, MIME type, size, magic bytes)
- Detected vs declared MIME types
- File size in MB
- Sanitized filenames

### Scenario: Website Crawler Stuck

**Symptoms**: Crawls timing out, no progress

**Solution**:
```bash
LOG_LEVEL_WEBSITE_CRAWLER=trace
```

**What to look for**:
- Page navigation durations
- Deduplication check results
- Puppeteer browser connection issues
- SSRF protection blocks

### Scenario: Search Returning No Results

**Symptoms**: Queries not finding expected content

**Solution**:
```bash
LOG_LEVEL_HYBRID_SEARCH=debug
LOG_LEVEL_ENTITY_RESOLUTION=debug
```

**What to look for**:
- Applied filters
- Vector vs text search weights
- Combined scores
- Embedding generation times

## Log Levels Explained

| Level | Description | Use Case |
|-------|-------------|----------|
| **error** | Critical failures only | Production monitoring |
| **warn** | Warnings and errors | Production default |
| **info** | Important state changes | Production baseline |
| **debug** | Detailed operational info | Troubleshooting |
| **trace** | Very verbose, every operation | Deep debugging |

## Best Practices

1. **Start with INFO**: Use `LOG_LEVEL=info` as your baseline in production
2. **Use module-specific debugging**: Don't lower the global level - target specific modules
3. **Trace is expensive**: Only enable TRACE level for performance-critical modules when actively debugging
4. **Monitor log volume**: Too much logging can impact performance and storage
5. **Use structured filters**: Leverage `jq` to filter JSON logs efficiently
6. **Security logs are non-negotiable**: Authentication and admin operations are always logged

## Correlation IDs

All logs automatically include correlation IDs when available:

- `correlationId` - Tracks a request across the entire system
- `requestId` - Unique ID for each HTTP request
- `signalId` - Links logs to specific signals
- `userId` - User performing the operation

Use correlation IDs to trace requests through the entire pipeline:

```bash
tail -f logs/combined.log | jq 'select(.correlationId == "abc-123")'
```

## Performance Impact

| Level | Performance Impact | Storage Impact |
|-------|-------------------|----------------|
| error | Negligible | Minimal |
| warn | Negligible | Low |
| info | Very low | Moderate |
| debug | Low | High |
| trace | Moderate (3-5%) | Very high |

Trace-level logging on high-frequency operations (cache access, retry logic) can reduce throughput by 3-5%. Only enable when actively debugging.

## Environment Variable Reference

Complete list of all configurable log levels:

```bash
# Global
LOG_LEVEL=info

# Infrastructure
LOG_LEVEL_CORRELATION=info
LOG_LEVEL_CACHE=info
LOG_LEVEL_RETRY=info
LOG_LEVEL_REDIS=info
LOG_LEVEL_HEALTH=info

# Services
LOG_LEVEL_FAILED_SIGNAL_RETRY=info
LOG_LEVEL_FILE_VALIDATION=debug
LOG_LEVEL_WEBSITE_CRAWLER=info
LOG_LEVEL_OPPORTUNITY=info
LOG_LEVEL_ENTITY_RESOLUTION=info
LOG_LEVEL_HYBRID_SEARCH=info
```

## Troubleshooting

### Logs not appearing?

1. Check that the module name matches exactly (case-sensitive)
2. Verify environment variables are exported: `echo $LOG_LEVEL_CACHE`
3. Restart the server after changing environment variables
4. Check that the log level hierarchy is correct (trace > debug > info > warn > error)

### Too many logs?

1. Increase the global LOG_LEVEL: `LOG_LEVEL=warn`
2. Disable trace logging on high-frequency operations
3. Use log rotation to manage storage
4. Filter logs using `jq` instead of reducing log levels

### Can't find specific events?

1. Check that you're using the right module name
2. Use `jq` to search across all fields: `jq 'select(. | tostring | contains("search_term"))'`
3. Enable debug level for the relevant module
4. Check security audit logs with `jq 'select(.security_event != null)'`

## Support

For issues or questions about logging:
- Check [LOGGING_AND_MONITORING.md](./LOGGING_AND_MONITORING.md) for architecture details
- Review the Winston configuration in `backend/utils/logger.ts`
- Search logs for module-specific events using the patterns above
