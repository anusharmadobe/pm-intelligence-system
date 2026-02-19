# Quick Start Guide

Get up and running with the PM Intelligence System in 5 minutes.

## 🚀 For Developers

### 1. Install Dependencies

```bash
# Backend
npm install

# Frontend (Chat UI)
cd frontend/chat-ui
npm install
cd ../..
```

### 2. Start Services

You'll need PostgreSQL, Neo4j, and Redis running. If using Docker:

```bash
# Start databases (if using Docker)
docker-compose up -d postgres neo4j redis
```

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your configuration
# At minimum, set:
# - Database credentials
# - API keys (OpenAI, Anthropic)
```

### 4. Run Migrations

```bash
# Run all database migrations
npm run migrate

# Or manually:
psql -U pm_intelligence -d pm_intelligence -f backend/db/migrations/V2_001_entity_registry.sql
# ... repeat for all migrations
```

### 5. Start Development Servers

**Terminal 1 - Backend API:**
```bash
npm run dev
# Runs on http://localhost:3000
```

**Terminal 2 - Chat UI:**
```bash
cd frontend/chat-ui
npm run dev
# Runs on http://localhost:3001
```

### 6. Access Chat UI

1. Open browser to `http://localhost:3001`
2. Create an API key (or use existing)
3. Start asking questions!

---

## 📝 Try It Out

### Using Chat UI

```
Query: "What are the top customer issues?"
→ System searches across all sources

Query: "Show me competitor blog posts about new features"
→ Routes to web_scrape source only

Query: "What did customers say in meetings about pricing?"
→ Routes to transcript source
```

### Using MCP Tools (in Claude Desktop)

```json
{
  "tool": "search_signals",
  "params": {
    "query": "authentication issues",
    "limit": 10
  }
}

{
  "tool": "crawl_website",
  "params": {
    "url": "https://competitor.com/blog",
    "content_type": "blog",
    "competitor": "Competitor X"
  }
}

{
  "tool": "correct_signal_extraction",
  "params": {
    "signal_id": "uuid-here",
    "correction_type": "customer_name",
    "field_path": "entities.customers[0]",
    "old_value": "Acme Inc",
    "new_value": "Acme Corporation",
    "apply_to_similar": true
  }
}
```

---

## 🔧 Configuration

### Enable Website Crawling

1. Edit `config/websites.json`
2. Update URLs to real competitors
3. Set `enabled: true`
4. Adjust `crawl_frequency` (6h, 12h, 24h)

Example:
```json
{
  "name": "Competitor X Blog",
  "url": "https://real-competitor.com/blog",
  "type": "blog",
  "competitor": "Competitor X",
  "crawl_frequency": "12h",
  "enabled": true,
  "tags": ["competitor", "product-updates"]
}
```

### Configure CORS for Chat UI

```bash
# .env
CORS_ORIGIN=http://localhost:3001,https://your-production-domain.com
```

---

## 📊 Key Features

### 1. **Chat UI**
- Natural language queries
- Source citations
- Conversation persistence
- Real-time updates

### 2. **Auto-Correction**
- Fix LLM extraction errors
- Auto-apply to similar signals
- Pattern learning
- Human verification

### 3. **Website Crawler**
- Automated competitor monitoring
- Configurable schedules
- Content deduplication
- CSS selector extraction

### 4. **Query Routing**
- Intelligent source selection
- Parallel searching
- Relevance ranking
- Source-specific filters

---

## 🐛 Common Issues

### Chat UI Can't Connect

```bash
# Check backend is running
curl http://localhost:3000/health

# Check CORS configuration
grep "CORS_ORIGIN" .env
```

### Website Crawler Not Working

```bash
# Check Puppeteer
node -e "const puppeteer = require('puppeteer'); console.log('OK');"

# Enable a source in config
cat config/websites.json | jq '.sources[] | select(.enabled==true)'
```

### TypeScript Errors

```bash
# Rebuild
npm run build

# Check for type errors
npx tsc --noEmit
```

---

## 📚 Next Steps

1. **Read Full Documentation:**
   - [FLUFFYJAWS_IMPLEMENTATION_SUMMARY.md](FLUFFYJAWS_IMPLEMENTATION_SUMMARY.md) - Feature overview
   - [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Production deployment

2. **Ingest Your Data:**
   - Upload documents via MCP `ingest_document`
   - Add meeting transcripts via `ingest_transcript`
   - Configure Slack integration

3. **Configure Competitors:**
   - Update `config/websites.json` with real URLs
   - Enable scheduled crawling
   - Monitor in logs

4. **Customize:**
   - Add new MCP tools
   - Extend query routing logic
   - Customize Chat UI theme

---

## 💡 Pro Tips

1. **Use Docker for Databases:**
   ```bash
   docker-compose up -d
   ```

2. **Monitor Logs:**
   ```bash
   tail -f logs/app.log | grep -E "status|error"
   ```

3. **Test One Feature at a Time:**
   - Start with Chat UI
   - Then enable website crawler
   - Then try auto-correction

4. **Check Performance:**
   ```bash
   # Database query times
   grep "duration_ms" logs/app.log | tail -20
   ```

---

## 🆘 Need Help?

- **Logs:** `logs/app.log` has detailed error messages
- **Health Check:** `curl http://localhost:3000/health`
- **Database:** `psql -U pm_intelligence -d pm_intelligence`
- **Documentation:** See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

---

**Ready to dive deeper?** Check out the [FLUFFYJAWS_IMPLEMENTATION_SUMMARY.md](FLUFFYJAWS_IMPLEMENTATION_SUMMARY.md) for full feature documentation.
