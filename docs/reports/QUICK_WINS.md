# Quick Wins - Things We Can Build Today

These are high-impact, low-effort improvements you can implement quickly.

## 1. Enhanced Health Check (30 minutes)

Add detailed health information to `/health` endpoint:

```typescript
// backend/api/server.ts
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: {
      connected: false,
      responseTime: null
    },
    uptime: process.uptime()
  };

  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    health.database.connected = true;
    health.database.responseTime = Date.now() - start;
  } catch (error) {
    health.status = 'degraded';
    health.database.error = error.message;
  }

  res.json(health);
});
```

## 2. Request Logging (30 minutes)

Add basic request logging:

```bash
npm install morgan
```

```typescript
// backend/api/server.ts
import morgan from 'morgan';
app.use(morgan('combined'));
```

## 3. Signal Deduplication (1 hour)

Prevent duplicate signals:

```typescript
// backend/processing/signal_extractor.ts
export async function ingestSignal(raw: RawSignal): Promise<Signal> {
  // Check for duplicate
  const existing = await pool.query(
    'SELECT id FROM signals WHERE source = $1 AND source_ref = $2',
    [raw.source, raw.id || '']
  );
  
  if (existing.rows.length > 0) {
    return existing.rows[0]; // Return existing signal
  }
  
  // ... rest of ingestion logic
}
```

## 4. Docker Setup (1 hour)

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DB_HOST=db
      - DB_NAME=pm_intelligence
      - DB_USER=anusharm
      - DB_PASSWORD=pm_intelligence
    depends_on:
      - db
  
  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=anusharm
      - POSTGRES_PASSWORD=pm_intelligence
      - POSTGRES_DB=pm_intelligence
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## 5. Opportunity Status Update (45 minutes)

Add status management:

```typescript
// backend/services/opportunity_service.ts
export async function updateOpportunityStatus(
  opportunityId: string,
  status: 'new' | 'in_progress' | 'resolved'
): Promise<void> {
  await pool.query(
    'UPDATE opportunities SET status = $1 WHERE id = $2',
    [status, opportunityId]
  );
}
```

## 6. Error Handling Middleware (30 minutes)

Add centralized error handling:

```typescript
// backend/api/server.ts
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
```

## 7. API Rate Limiting (20 minutes)

```bash
npm install express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

## 8. Environment-based Config (15 minutes)

Add `.env.example`:
```bash
cp .env .env.example
# Remove actual passwords
```

Add config validation:
```typescript
// backend/config/env.ts
export function validateConfig() {
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
```

## Priority Order

1. **Test Slack MCP** (15 min) - Validate it works
2. **Add logging** (30 min) - Essential for debugging
3. **Signal deduplication** (1 hour) - Prevents data issues
4. **Docker setup** (1 hour) - Easy deployment
5. **Health check** (30 min) - Production readiness

## Estimated Time

- **Quick wins total**: ~4 hours
- **High impact**: Logging, deduplication, Docker
- **Low effort**: Health check, error handling, rate limiting
