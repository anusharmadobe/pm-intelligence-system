# PM Intelligence System - Development Roadmap

## 🎯 Current Status

✅ **Core System**: Fully implemented and working
✅ **Database**: Set up and verified
✅ **API**: REST API with webhooks ready
✅ **Cursor Extension**: Commands implemented
✅ **Slack MCP**: Integration code ready

## 🚀 Immediate Next Steps (This Week)

### 1. Test & Validate Slack MCP Integration ⚡
**Priority: HIGH** - Validate the integration works end-to-end

- [ ] Test Slack MCP commands in Cursor IDE
- [ ] Verify messages are ingested correctly
- [ ] Test opportunity detection on real Slack data
- [ ] Fix any MCP API access issues
- [ ] Document any Cursor-specific MCP patterns discovered

**Commands to test:**
```bash
# In Cursor IDE:
PM Intelligence: List Slack Channels (MCP)
PM Intelligence: Ingest Slack Channel (MCP)
PM Intelligence: View Signals
PM Intelligence: Detect Opportunities
```

### 2. Add Logging & Error Handling 📝
**Priority: HIGH** - Essential for debugging and production

- [ ] Install Winston or Pino logger
- [ ] Add structured logging throughout
- [ ] Log all signal ingestion events
- [ ] Log LLM calls and responses
- [ ] Add error tracking and reporting
- [ ] Create log rotation strategy

**Files to update:**
- `backend/api/server.ts` - Add request logging
- `backend/processing/signal_extractor.ts` - Log ingestion
- `backend/services/judgment_service.ts` - Log LLM calls
- `backend/services/llm_service.ts` - Log LLM requests/responses

### 3. Test Core Functionality 🧪
**Priority: HIGH** - Ensure reliability

- [ ] Test signal ingestion (API + Extension)
- [ ] Test opportunity clustering with various signal sets
- [ ] Test judgment creation with LLM
- [ ] Test artifact generation
- [ ] Test error scenarios (invalid data, DB failures)
- [ ] Test Slack MCP integration end-to-end

**Quick test script:**
```bash
# Seed sample data
npm run seed

# Test API
curl http://localhost:3000/api/signals
curl -X POST http://localhost:3000/api/opportunities/detect
curl http://localhost:3000/api/metrics

# Test extension commands in Cursor
```

## 📅 Short-term (Next 2 Weeks)

### 4. Docker Setup 🐳
**Priority: MEDIUM-HIGH** - Easy deployment

- [ ] Create Dockerfile for API server
- [ ] Create docker-compose.yml (API + PostgreSQL)
- [ ] Add environment variable management
- [ ] Create docker-compose.dev.yml for development
- [ ] Document Docker usage

**Files to create:**
- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.dev.yml`
- `.dockerignore`

### 5. Signal Deduplication 🔍
**Priority: MEDIUM** - Prevent duplicate signals

- [ ] Add signal deduplication logic
- [ ] Check for duplicate content before ingestion
- [ ] Use source_ref + source as unique key
- [ ] Add deduplication metrics
- [ ] Handle near-duplicates (fuzzy matching)

**Implementation approach:**
- Check `source` + `source_ref` combination
- Optionally check `normalized_content` similarity
- Return existing signal ID if duplicate found

### 6. Opportunity Status Management 📊
**Priority: MEDIUM** - Workflow improvement

- [ ] Add status transitions (new → in_progress → resolved)
- [ ] Add status update API endpoint
- [ ] Add status update command in extension
- [ ] Track status change history
- [ ] Add status-based filtering

**Status workflow:**
```
new → in_progress → resolved
     ↓
  archived (optional)
```

### 7. Enhanced Health Checks 🏥
**Priority: MEDIUM** - Production readiness

- [ ] Enhance `/health` endpoint
- [ ] Add database connection check
- [ ] Add database query performance check
- [ ] Add disk space check
- [ ] Add readiness/liveness endpoints
- [ ] Add metrics endpoint (Prometheus format)

## 📅 Medium-term (Next Month)

### 8. Unit & Integration Tests 🧪
**Priority: MEDIUM** - Code quality

- [ ] Set up Jest testing framework
- [ ] Add unit tests for signal extraction
- [ ] Add unit tests for opportunity clustering
- [ ] Add unit tests for validation
- [ ] Add integration tests for API endpoints
- [ ] Add tests for database operations
- [ ] Set up test coverage reporting

**Test structure:**
```
backend/
  __tests__/
    unit/
      signal_extractor.test.ts
      opportunity_service.test.ts
      validation.test.ts
    integration/
      api.test.ts
      db.test.ts
```

### 9. Security Enhancements 🔒
**Priority: MEDIUM** - Production security

- [ ] Implement RBAC (Role-Based Access Control)
- [ ] Add JWT authentication for API
- [ ] Add webhook signature verification
- [ ] Add rate limiting (express-rate-limit)
- [ ] Add input sanitization
- [ ] Add CORS configuration
- [ ] Add API key authentication option

### 10. Extension UI Improvements 🎨
**Priority: MEDIUM** - Better UX

- [ ] Add signal import from CSV/JSON files
- [ ] Add opportunity visualization (tree view)
- [ ] Add judgment comparison view
- [ ] Add keyboard shortcuts
- [ ] Add status bar indicators (signal count, etc.)
- [ ] Add quick actions menu
- [ ] Improve error messages and feedback

### 11. Monitoring & Observability 📈
**Priority: MEDIUM** - Production monitoring

- [ ] Add structured logging (Winston/Pino)
- [ ] Add error tracking (Sentry or similar)
- [ ] Add performance monitoring
- [ ] Add custom metrics (signals/hour, opportunities/day)
- [ ] Add alerting for critical errors
- [ ] Add dashboard for key metrics

## 📅 Long-term (Future)

### 12. Advanced Features 🚀
**Priority: LOW** - Nice to have

- [ ] Judgment versioning/history
- [ ] Artifact templates
- [ ] Bulk signal import
- [ ] Signal search/filtering UI
- [ ] Export opportunities/judgments to JSON/CSV
- [ ] Signal tagging system
- [ ] Custom opportunity detection rules

### 13. Additional Integrations 🔌
**Priority: LOW** - Expand signal sources

- [ ] Jira integration
- [ ] GitHub Issues integration
- [ ] Customer support tickets (Zendesk, etc.)
- [ ] Email integration
- [ ] Calendar events integration

### 14. Performance Optimizations ⚡
**Priority: LOW** - Scale improvements

- [ ] Add Redis caching layer
- [ ] Optimize database queries
- [ ] Add pagination for large datasets
- [ ] Add background job processing
- [ ] Optimize opportunity clustering algorithm

### 15. Documentation 📚
**Priority: LOW** - Developer experience

- [ ] Architecture diagrams
- [ ] Deployment guide
- [ ] Troubleshooting guide
- [ ] Contributor guide
- [ ] API examples and use cases
- [ ] Video tutorials

## 🎯 Recommended Order

**Week 1:**
1. Test Slack MCP integration
2. Add logging
3. Test core functionality

**Week 2:**
4. Docker setup
5. Signal deduplication
6. Opportunity status management

**Week 3-4:**
7. Enhanced health checks
8. Unit & integration tests
9. Security enhancements

**Month 2:**
10. Extension UI improvements
11. Monitoring & observability
12. Advanced features (as needed)

## 💡 Quick Wins (Can Do Today)

1. **Add request logging** - 30 minutes
2. **Test Slack MCP commands** - 15 minutes
3. **Add signal deduplication** - 1 hour
4. **Create Dockerfile** - 1 hour
5. **Add health check details** - 30 minutes

## 📋 Decision Points

Before proceeding, decide:

1. **Testing Strategy**: Unit tests first, or integration tests?
2. **Deployment Target**: Docker, Kubernetes, or cloud platform?
3. **Monitoring**: Self-hosted or SaaS (Sentry, Datadog)?
4. **Authentication**: JWT, API keys, or OAuth?
5. **Scaling Needs**: Single instance or distributed?

## 🚦 Getting Started

**To start with the highest priority items:**

```bash
# 1. Test Slack MCP (do this first!)
# Open Cursor IDE and test the Slack MCP commands

# 2. Add logging
npm install winston
# Then update backend files to use logger

# 3. Create Docker setup
# Create Dockerfile and docker-compose.yml

# 4. Add tests
npm install --save-dev jest @types/jest ts-jest
# Create test files
```

## 📝 Notes

- All changes must comply with `/specs` contracts
- LLMs only allowed in Judgment and Artifact layers
- Signals remain immutable
- No autonomous decisions
- Test Slack MCP integration first - it's the newest feature
