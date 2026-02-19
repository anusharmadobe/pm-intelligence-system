# PM Intelligence System - Deployment Guide

Complete guide for deploying the PM Intelligence System with all FluffyJaws-inspired features.

## Prerequisites

### System Requirements

- **Node.js**: v18+ (LTS recommended)
- **PostgreSQL**: v14+ with pgvector extension
- **Neo4j**: v5+ (for knowledge graph)
- **Redis**: v7+ (for caching and queues)
- **Python**: 3.9+ (for embedding services)

### Environment Setup

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd PM_cursor_system

   # Install backend dependencies
   npm install

   # Install frontend dependencies
   cd frontend/chat-ui
   npm install
   cd ../..
   ```

2. **Configure Environment Variables**

   Copy `.env.example` to `.env` and configure:

   ```bash
   # Database
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_USER=pm_intelligence
   POSTGRES_PASSWORD=your_secure_password
   POSTGRES_DB=pm_intelligence

   # Neo4j (Knowledge Graph)
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your_neo4j_password

   # Redis
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=your_redis_password

   # Embedding Provider (choose one)
   EMBEDDING_PROVIDER=openai  # or 'cohere', 'huggingface', 'local'
   OPENAI_API_KEY=your_openai_key

   # LLM Provider
   LLM_PROVIDER=anthropic
   ANTHROPIC_API_KEY=your_anthropic_key

   # Chat UI
   CORS_ORIGIN=http://localhost:3001,https://your-production-domain.com
   NEXT_PUBLIC_API_URL=http://localhost:3000

   # Website Crawling
   ENABLE_WEBSITE_CRAWLING=true
   WEBSITE_CONFIG_PATH=config/websites.json
   PUPPETEER_HEADLESS=true

   # Auto-Correction
   AUTO_CORRECTION_SIMILARITY_THRESHOLD=0.85
   AUTO_CORRECTION_MAX_SIMILAR_SIGNALS=50

   # Server
   PORT=3000
   NODE_ENV=production
   ```

---

## Database Setup

### 1. PostgreSQL Setup

```bash
# Create database and user
psql -U postgres <<EOF
CREATE DATABASE pm_intelligence;
CREATE USER pm_intelligence WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE pm_intelligence TO pm_intelligence;
EOF

# Install pgvector extension
psql -U pm_intelligence -d pm_intelligence <<EOF
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOF
```

### 2. Run Database Migrations

```bash
# Run all migrations in order
npm run migrate

# Or run specific migration
psql -U pm_intelligence -d pm_intelligence -f backend/db/migrations/V2_001_entity_registry.sql
psql -U pm_intelligence -d pm_intelligence -f backend/db/migrations/V2_020_auto_correction.sql
# ... repeat for all migrations
```

### 3. Verify Database Setup

```bash
psql -U pm_intelligence -d pm_intelligence <<EOF
-- Check tables
\dt

-- Check extensions
\dx

-- Verify signal_corrections table exists
SELECT COUNT(*) FROM signal_corrections;
EOF
```

---

## Application Deployment

### Backend API Server

#### Development Mode

```bash
# Start backend server
npm run dev

# Or with specific environment
NODE_ENV=development npm start
```

#### Production Mode

```bash
# Build TypeScript
npm run build

# Start production server
NODE_ENV=production npm start

# Or use PM2 for process management
pm2 start ecosystem.config.js
```

#### PM2 Configuration (`ecosystem.config.js`)

```javascript
module.exports = {
  apps: [{
    name: 'pm-intelligence-api',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: 'logs/api-error.log',
    out_file: 'logs/api-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
```

### Chat UI Frontend

#### Development Mode

```bash
cd frontend/chat-ui
npm run dev
# Runs on http://localhost:3001
```

#### Production Build

```bash
cd frontend/chat-ui

# Build for production
npm run build

# Start production server
npm start

# Or use PM2
pm2 start npm --name "pm-chat-ui" -- start
```

#### Production with Nginx

```nginx
# /etc/nginx/sites-available/pm-intelligence-chat

server {
    listen 80;
    server_name chat.your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name chat.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/chat.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Website Crawler Setup

### 1. Configure Competitor Sources

Edit `config/websites.json`:

```json
{
  "sources": [
    {
      "name": "Competitor X Blog",
      "url": "https://competitorx.com/blog",
      "type": "blog",
      "competitor": "Competitor X",
      "crawl_frequency": "12h",
      "enabled": true,
      "selectors": {
        "content": "article.post-content",
        "title": "h1.post-title",
        "date": "time.published"
      },
      "tags": ["competitor", "product-updates"],
      "maxPages": 10
    }
  ]
}
```

### 2. Test Manual Crawl

```bash
# Via MCP tool (in Claude Desktop or API):
{
  "tool": "crawl_website",
  "params": {
    "url": "https://competitorx.com/blog",
    "content_type": "blog",
    "competitor": "Competitor X"
  }
}
```

### 3. Enable Scheduled Crawling

Scheduled crawling runs automatically via `IngestionSchedulerService`:

```typescript
// Already configured in backend/services/ingestion_scheduler_service.ts
// Crawls run based on crawl_frequency in config/websites.json
```

Check logs for crawl status:
```bash
grep "website_crawler" logs/app.log
```

---

## MCP Server Setup

### For Claude Desktop

1. **Configure Claude Desktop MCP Settings**

   Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

   ```json
   {
     "mcpServers": {
       "pm-intelligence": {
         "command": "node",
         "args": ["/path/to/PM_cursor_system/backend/mcp/server.js"],
         "env": {
           "POSTGRES_HOST": "localhost",
           "POSTGRES_PORT": "5432",
           "POSTGRES_USER": "pm_intelligence",
           "POSTGRES_PASSWORD": "your_password",
           "POSTGRES_DB": "pm_intelligence",
           "NEO4J_URI": "bolt://localhost:7687",
           "NEO4J_USER": "neo4j",
           "NEO4J_PASSWORD": "your_neo4j_password",
           "EMBEDDING_PROVIDER": "openai",
           "OPENAI_API_KEY": "your_key",
           "LLM_PROVIDER": "anthropic",
           "ANTHROPIC_API_KEY": "your_key"
         }
       }
     }
   }
   ```

2. **Restart Claude Desktop**

3. **Verify MCP Tools Available**

   In Claude Desktop, you should see tools like:
   - `search_signals`
   - `correct_signal_extraction`
   - `crawl_website`
   - `search_slack`
   - `search_transcripts`
   - `search_documents`
   - `search_web_content`

---

## Health Checks & Monitoring

### Verify Deployment

```bash
# API Health Check
curl http://localhost:3000/health

# Expected response:
{
  "status": "ok",
  "postgres": "connected",
  "neo4j": "connected",
  "redis": "connected",
  "version": "2.0.0"
}

# Chat UI Health
curl http://localhost:3001

# Expected: HTML response
```

### Monitor Logs

```bash
# API logs
tail -f logs/app.log | grep -E "status|error"

# Website crawler logs
tail -f logs/app.log | grep "website_crawler"

# Auto-correction logs
tail -f logs/app.log | grep "auto_correction"

# Query routing logs
tail -f logs/app.log | grep "query_routing"
```

### Key Metrics to Monitor

1. **API Metrics:**
   - Request rate
   - Error rate
   - Response times
   - Database connection pool usage

2. **Website Crawler:**
   - Crawl success rate
   - Signals created per crawl
   - Deduplication rate
   - Crawl duration

3. **Auto-Correction:**
   - Corrections applied
   - Similar signals corrected
   - Pattern accuracy rate
   - Auto-correction success rate

4. **Chat UI:**
   - Active users
   - Query response times
   - Error rates
   - API key validation failures

---

## Production Checklist

### Security

- [ ] Change all default passwords
- [ ] Enable SSL/TLS for all services
- [ ] Configure firewall rules
- [ ] Set up API key authentication
- [ ] Enable rate limiting (set `DISABLE_RATE_LIMITING=false`)
- [ ] Review and restrict CORS origins
- [ ] Enable database connection encryption
- [ ] Set up secure session management
- [ ] Configure secrets management (AWS Secrets Manager, HashiCorp Vault, etc.)

### Performance

- [ ] Enable Redis caching
- [ ] Configure database connection pooling
- [ ] Set up CDN for static assets
- [ ] Enable gzip compression
- [ ] Configure database indexes (already in migrations)
- [ ] Set up read replicas for PostgreSQL
- [ ] Configure Neo4j memory settings
- [ ] Enable query result caching

### Monitoring

- [ ] Set up error tracking (Sentry, Rollbar, etc.)
- [ ] Configure log aggregation (ELK, Datadog, etc.)
- [ ] Set up uptime monitoring
- [ ] Configure alerting (PagerDuty, OpsGenie, etc.)
- [ ] Set up performance monitoring (New Relic, APM)
- [ ] Configure database monitoring
- [ ] Set up scheduled health checks

### Backup & Recovery

- [ ] Configure automated database backups
- [ ] Set up Neo4j backup schedule
- [ ] Test backup restoration procedure
- [ ] Document recovery procedures
- [ ] Set up offsite backup storage
- [ ] Configure backup retention policy

### Documentation

- [ ] Document production URLs and credentials
- [ ] Create runbook for common issues
- [ ] Document deployment procedures
- [ ] Create troubleshooting guide
- [ ] Document API endpoints
- [ ] Create user guides for Chat UI

---

## Troubleshooting

### Common Issues

#### 1. Chat UI Cannot Connect to API

**Symptoms:** API key validation fails, connection errors

**Solutions:**
```bash
# Check CORS configuration
grep "CORS_ORIGIN" .env

# Verify API is running
curl http://localhost:3000/health

# Check backend logs
tail -f logs/app.log | grep "CORS\|origin"
```

#### 2. Website Crawler Failing

**Symptoms:** No signals created, crawl errors in logs

**Solutions:**
```bash
# Check Puppeteer installation
node -e "const puppeteer = require('puppeteer'); console.log('OK');"

# Test manual crawl with logging
grep "website_crawler" logs/app.log | tail -20

# Verify website config
cat config/websites.json | jq '.sources[] | select(.enabled==true)'
```

#### 3. Auto-Correction Not Working

**Symptoms:** Corrections not applying, similarity search failing

**Solutions:**
```bash
# Verify signal_corrections table exists
psql -U pm_intelligence -d pm_intelligence -c "\d signal_corrections"

# Check embeddings are generated
psql -U pm_intelligence -d pm_intelligence -c "SELECT COUNT(*) FROM signal_embeddings;"

# Check auto-correction logs
grep "auto_correction" logs/app.log | tail -20
```

#### 4. Database Connection Errors

**Symptoms:** "ECONNREFUSED", "Connection timeout"

**Solutions:**
```bash
# Test PostgreSQL connection
psql -U pm_intelligence -h localhost -d pm_intelligence -c "SELECT 1;"

# Check database logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log

# Verify connection pool settings
grep "POSTGRES_" .env
```

---

## Scaling Considerations

### Horizontal Scaling

1. **API Servers:** Run multiple instances behind a load balancer
2. **Database:** Set up read replicas for query distribution
3. **Neo4j:** Configure causal clustering for high availability
4. **Redis:** Use Redis Cluster for distributed caching

### Vertical Scaling

1. **Increase Database Resources:**
   - Memory for caching
   - CPU for query processing
   - Storage for data growth

2. **Optimize Queries:**
   - Review slow query logs
   - Add missing indexes
   - Optimize embedding search

### Caching Strategy

```typescript
// Example: Cache frequently accessed data
const cacheKey = `customer_profile:${customerName}`;
const cached = await redis.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const data = await fetchFromDatabase();
await redis.set(cacheKey, JSON.stringify(data), 'EX', 3600); // 1 hour TTL
return data;
```

---

## Support & Maintenance

### Regular Maintenance Tasks

**Daily:**
- Monitor error rates and logs
- Check crawler success rates
- Verify backup completion

**Weekly:**
- Review slow queries
- Check disk space usage
- Analyze auto-correction accuracy

**Monthly:**
- Update dependencies
- Review security patches
- Optimize database indexes
- Clean up old logs

### Getting Help

- **Documentation:** See [FLUFFYJAWS_IMPLEMENTATION_SUMMARY.md](FLUFFYJAWS_IMPLEMENTATION_SUMMARY.md)
- **Logs:** Check `logs/app.log` for detailed error messages
- **Health Check:** Use `/health` endpoint for system status
- **Database:** Use `psql` to query database state

---

## Version History

- **v2.0.0** (Feb 2026): Added FluffyJaws-inspired features
  - Chat UI frontend
  - Auto-correction mechanism
  - Website crawler
  - Query routing by source

---

**Last Updated:** February 18, 2026
