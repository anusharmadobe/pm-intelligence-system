# V2 Knowledge Graph — Neo4j Design

> **Version:** 2.0
> **Date:** 2026-02-09
> **Status:** Approved for Build

---

## 1. Purpose

The knowledge graph stores entity-relationship data in Neo4j Community Edition, enabling multi-hop queries that are impractical in PostgreSQL (e.g., "Which customers reported issues related to features that depend on the authentication service?").

**Key principle:** Neo4j is a **derived view** of data whose source of truth lives in PostgreSQL. If they diverge, PostgreSQL wins.

---

## 2. Neo4j Node Schema

### 2.1 Core Nodes

```cypher
// Customer node
CREATE CONSTRAINT customer_id IF NOT EXISTS FOR (c:Customer) REQUIRE c.id IS UNIQUE;
(:Customer {
  id: "uuid",                    // Maps to entity_registry.id
  canonical_name: "Acme Corporation",
  segment: "enterprise",         // 'enterprise', 'mid-market', 'smb', 'unknown'
  tier: "tier-1",
  health_score: 85.0,
  first_seen: datetime(),
  last_signal: datetime(),
  signal_count: 47,
  metadata: "{...}"              // JSON string for flexible attributes
})

// Feature node
CREATE CONSTRAINT feature_id IF NOT EXISTS FOR (f:Feature) REQUIRE f.id IS UNIQUE;
(:Feature {
  id: "uuid",
  canonical_name: "Authentication Service",
  product_area: "security",
  status: "active",              // 'active', 'deprecated', 'planned', 'beta'
  maturity: "stable",
  first_seen: datetime(),
  last_signal: datetime(),
  signal_count: 132
})

// Issue node
CREATE CONSTRAINT issue_id IF NOT EXISTS FOR (i:Issue) REQUIRE i.id IS UNIQUE;
(:Issue {
  id: "uuid",
  canonical_name: "Authentication Timeout",
  category: "performance",       // 'bug', 'performance', 'usability', 'security', 'feature_gap'
  severity: "high",              // 'critical', 'high', 'medium', 'low'
  status: "open",                // 'open', 'investigating', 'resolved', 'wontfix'
  first_reported: datetime(),
  last_reported: datetime(),
  report_count: 23
})

// Theme node
CREATE CONSTRAINT theme_id IF NOT EXISTS FOR (t:Theme) REQUIRE t.id IS UNIQUE;
(:Theme {
  id: "uuid",
  canonical_name: "Platform Reliability",
  level: 2,                      // 1=Domain, 2=Category, 3=Theme, 4=Sub-theme
  slug: "platform-reliability",
  trend_direction: "emerging",   // 'emerging', 'growing', 'stable', 'declining'
  signal_count: 89
})

// Signal node (lightweight reference — full data in PostgreSQL)
CREATE CONSTRAINT signal_id IF NOT EXISTS FOR (s:Signal) REQUIRE s.id IS UNIQUE;
(:Signal {
  id: "uuid",
  source: "slack",               // 'slack', 'meeting_transcript', 'document', 'web_scrape', etc.
  source_id: "original-source-id",
  timestamp: datetime(),
  content_preview: "First 200 chars...",  // For display only; full content in PostgreSQL
  author: "alice",
  channel: "customer-support"
})

// Opportunity node
CREATE CONSTRAINT opportunity_id IF NOT EXISTS FOR (o:Opportunity) REQUIRE o.id IS UNIQUE;
(:Opportunity {
  id: "uuid",
  title: "Authentication Performance Improvement",
  status: "new",
  impact_score: 8.5,
  confidence_score: 0.82,
  effort_score: 5.0,
  strategic_score: 7.0,
  urgency_score: 9.0,
  total_score: 78.5,
  signal_count: 23,
  created_at: datetime()
})

// Stakeholder node
CREATE CONSTRAINT stakeholder_id IF NOT EXISTS FOR (st:Stakeholder) REQUIRE st.id IS UNIQUE;
(:Stakeholder {
  id: "uuid",
  canonical_name: "Alice Chen",
  role: "Engineering Manager",
  team: "Platform",
  department: "Engineering"
})

// Decision node (from judgments)
CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE;
(:Decision {
  id: "uuid",                     // Maps to judgments.id
  title: "Prioritize auth timeout fix",
  outcome: "approved",
  confidence: "high",
  rationale: "23 customer reports...",
  decided_at: datetime()
})

// Artifact node
CREATE CONSTRAINT artifact_id IF NOT EXISTS FOR (a:Artifact) REQUIRE a.id IS UNIQUE;
(:Artifact {
  id: "uuid",
  artifact_type: "PRD",           // 'PRD', 'RFC', 'JIRA'
  title: "Authentication Performance Improvement PRD",
  status: "draft",
  created_at: datetime()
})
```

### 2.2 Relationship Schema

```cypher
// Customer relationships
(Customer)-[:REPORTED {timestamp, channel, signal_id}]->(Signal)
(Customer)-[:USES {since, frequency, last_used}]->(Feature)
(Customer)-[:AFFECTED_BY {severity, first_reported, report_count}]->(Issue)
(Customer)-[:MENTIONED_IN]->(Signal)

// Feature relationships
(Feature)-[:HAS_ISSUE {since, severity}]->(Issue)
(Feature)-[:BELONGS_TO_AREA]->(Theme)
(Feature)-[:DEPENDS_ON]->(Feature)
(Feature)-[:OWNED_BY]->(Stakeholder)

// Issue relationships
(Issue)-[:RELATED_TO]->(Issue)
(Issue)-[:CATEGORIZED_AS]->(Theme)
(Issue)-[:FIRST_REPORTED_IN]->(Signal)

// Signal relationships
(Signal)-[:MENTIONS_CUSTOMER]->(Customer)
(Signal)-[:MENTIONS_FEATURE]->(Feature)
(Signal)-[:DESCRIBES_ISSUE]->(Issue)
(Signal)-[:TAGGED_WITH]->(Theme)
(Signal)-[:CLUSTERED_INTO]->(Opportunity)

// Theme relationships
(Theme)-[:PARENT_OF]->(Theme)
(Theme)-[:RELATED_TO]->(Theme)

// Opportunity → Decision → Artifact chain
(Opportunity)-[:LED_TO]->(Decision)
(Decision)-[:PRODUCED]->(Artifact)

// Stakeholder relationships
(Stakeholder)-[:OWNS]->(Feature)
(Stakeholder)-[:RESPONSIBLE_FOR]->(Opportunity)
(Stakeholder)-[:INVOLVED_IN]->(Decision)
(Stakeholder)-[:ESCALATED {timestamp, severity}]->(Issue)

// Dependency & blocking relationships
(Feature)-[:BLOCKS]->(Feature)
(Issue)-[:BLOCKS]->(Feature)
(Feature)-[:ENABLES]->(Feature)

// Competitive intelligence (from web scrape signals)
(Customer)-[:ALSO_USES {source: 'web_scrape'}]->(Feature)  // Competitor feature usage

// Strategic grouping (PM Leader persona — see 07_FEEDBACK_LOOPS.md §6.4)
// These relationships support portfolio-level rollup queries without merging individual entities
(Feature)-[:GROUPS_INTO {created_by: 'pm_leader', created_at: datetime}]->(Feature)
// Example: SSO -[:GROUPS_INTO]-> Authentication Platform
//          MFA -[:GROUPS_INTO]-> Authentication Platform
// Usage: Strategic queries (heatmaps, roadmap) use grouped entities;
//        Operational queries (customer deep-dives) use individual entities
```

---

## 3. Sync Patterns

### 3.1 Event-Driven Sync (Primary)

After each signal processing pipeline completes:

```typescript
// In the pipeline, after entity resolution:
async function syncSignalToGraph(signalId: string): Promise<void> {
  const signal = await getSignal(signalId);
  const extractions = await getExtractions(signalId);
  
  // 1. Upsert signal node
  await neo4j.run(`
    MERGE (s:Signal {id: $id})
    SET s.source = $source, s.timestamp = datetime($timestamp),
        s.content_preview = $preview, s.author = $author
  `, { id: signal.id, source: signal.source, ... });
  
  // 2. For each resolved entity, upsert node and create relationship
  for (const extraction of extractions) {
    if (!extraction.canonical_entity_id) continue;
    
    const entity = await getCanonicalEntity(extraction.canonical_entity_id);
    const label = entityTypeToLabel(entity.entity_type); // 'Customer', 'Feature', etc.
    
    // Upsert entity node
    await neo4j.run(`
      MERGE (e:${label} {id: $id})
      SET e.canonical_name = $name, e.updated_at = datetime()
    `, { id: entity.id, name: entity.canonical_name });
    
    // Create signal→entity relationship
    const relType = entityTypeToRelationship(entity.entity_type);
    await neo4j.run(`
      MATCH (s:Signal {id: $signalId}), (e:${label} {id: $entityId})
      MERGE (s)-[:${relType}]->(e)
    `, { signalId: signal.id, entityId: entity.id });
  }
  
  // 3. Create entity↔entity relationships (from relationship extraction)
  const relationships = await getEntityRelationships(signalId);
  for (const rel of relationships) {
    await neo4j.run(`
      MATCH (a {id: $fromId}), (b {id: $toId})
      MERGE (a)-[:${rel.type} {signal_id: $signalId}]->(b)
    `, { fromId: rel.from_entity_id, toId: rel.to_entity_id, signalId: signal.id });
  }
}
```

### 3.2 Nightly Consistency Check

```typescript
async function runConsistencyCheck(): Promise<ConsistencyReport> {
  // Count entities in PostgreSQL vs Neo4j
  const pgCount = await pg.query('SELECT entity_type, COUNT(*) FROM entity_registry WHERE is_active = true GROUP BY entity_type');
  const neo4jCount = await neo4j.run('MATCH (n) WHERE n.id IS NOT NULL RETURN labels(n)[0] AS type, COUNT(n) AS count');
  
  // Find orphaned nodes in Neo4j (no corresponding PostgreSQL record)
  const orphans = await neo4j.run(`
    MATCH (n) WHERE n.id IS NOT NULL
    RETURN n.id AS id, labels(n)[0] AS type
  `);
  // Cross-reference with PostgreSQL entity_registry
  
  // Find missing entities (in PostgreSQL but not in Neo4j)
  // ... 
  
  // Report discrepancies
  return { pgCounts, neo4jCounts, orphanedNodes, missingNodes, syncedAt: new Date() };
}
```

### 3.3 Handling Entity Merges in Neo4j

When two entities are merged in the entity registry, Neo4j must be updated:

```typescript
async function handleEntityMerge(
  survivingEntityId: string, 
  absorbedEntityId: string,
  entityType: string
): Promise<void> {
  const label = entityTypeToLabel(entityType);
  
  // 1. Transfer all relationships from absorbed entity to surviving entity
  await neo4j.run(`
    MATCH (absorbed:${label} {id: $absorbedId})-[r]->(target)
    MATCH (surviving:${label} {id: $survivingId})
    MERGE (surviving)-[newRel:${type(r)}]->(target)
    SET newRel = properties(r)
    DELETE r
  `, { absorbedId: absorbedEntityId, survivingId: survivingEntityId });
  
  // 2. Transfer incoming relationships
  await neo4j.run(`
    MATCH (source)-[r]->(absorbed:${label} {id: $absorbedId})
    MATCH (surviving:${label} {id: $survivingId})
    MERGE (source)-[newRel:${type(r)}]->(surviving)
    SET newRel = properties(r)
    DELETE r
  `, { absorbedId: absorbedEntityId, survivingId: survivingEntityId });
  
  // 3. Delete the absorbed node
  await neo4j.run(`
    MATCH (absorbed:${label} {id: $absorbedId})
    DETACH DELETE absorbed
  `, { absorbedId: absorbedEntityId });
  
  // 4. Update surviving entity properties (new name, aliases, etc.)
  const entity = await getCanonicalEntity(survivingEntityId);
  await neo4j.run(`
    MATCH (e:${label} {id: $id})
    SET e.canonical_name = $name, e.updated_at = datetime()
  `, { id: survivingEntityId, name: entity.canonical_name });
}
```

### 3.4 Handling Neo4j Sync Backlog

When Neo4j is unavailable (circuit breaker OPEN), sync operations are queued:

```sql
CREATE TABLE neo4j_sync_backlog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation VARCHAR(30) NOT NULL,  -- 'signal_sync', 'entity_merge', 'entity_split', 'relationship_add'
  payload JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);
```

When Neo4j recovers (circuit breaker → HALF_OPEN → CLOSED):
1. Process backlog in chronological order
2. Merge operations before signal syncs (ensure entity structure is correct first)
3. After backlog clear: run consistency check to verify

### 3.5 Full Resync (Manual/Recovery)

```typescript
async function fullResync(): Promise<void> {
  // 1. Clear all Neo4j data
  await neo4j.run('MATCH (n) DETACH DELETE n');
  
  // 2. Recreate constraints
  await createConstraints();
  
  // 3. Bulk load entities from entity_registry
  const entities = await pg.query('SELECT * FROM entity_registry WHERE is_active = true');
  // Batch insert into Neo4j
  
  // 4. Bulk load relationships from signal_extractions + entity relationships
  // ...
  
  // 5. Verify counts match
  await runConsistencyCheck();
}
```

---

## 4. Key Query Patterns

### 4.1 Customer Impact Queries

```cypher
// Which customers are affected by an issue?
MATCH (c:Customer)-[:AFFECTED_BY]->(i:Issue {id: $issueId})
RETURN c.canonical_name AS customer, c.segment, c.tier,
       c.signal_count AS total_signals
ORDER BY c.tier, c.signal_count DESC

// How many customers use a specific feature?
MATCH (c:Customer)-[u:USES]->(f:Feature {id: $featureId})
RETURN COUNT(c) AS customer_count, 
       COLLECT(c.canonical_name) AS customers,
       AVG(u.frequency) AS avg_usage_frequency

// Customer 360: everything about a customer
MATCH (c:Customer {id: $customerId})
OPTIONAL MATCH (c)-[:USES]->(f:Feature)
OPTIONAL MATCH (c)-[:AFFECTED_BY]->(i:Issue)
OPTIONAL MATCH (c)-[:REPORTED]->(s:Signal)
RETURN c, COLLECT(DISTINCT f) AS features, 
       COLLECT(DISTINCT i) AS issues,
       COUNT(DISTINCT s) AS signal_count
```

### 4.2 Feature Health Queries

```cypher
// Feature health: issues + customer adoption
MATCH (f:Feature {id: $featureId})
OPTIONAL MATCH (f)<-[:USES]-(c:Customer)
OPTIONAL MATCH (f)-[:HAS_ISSUE]->(i:Issue)
OPTIONAL MATCH (f)<-[:MENTIONS_FEATURE]-(s:Signal)
WHERE s.timestamp > datetime() - duration('P30D')
RETURN f.canonical_name AS feature,
       COUNT(DISTINCT c) AS customer_count,
       COUNT(DISTINCT i) AS open_issues,
       COUNT(DISTINCT s) AS recent_signals
```

### 4.3 Heatmap Queries

```cypher
// Issue heatmap: issues by feature area
MATCH (i:Issue)<-[:HAS_ISSUE]-(f:Feature)
OPTIONAL MATCH (c:Customer)-[:AFFECTED_BY]->(i)
RETURN f.canonical_name AS feature, f.product_area,
       i.canonical_name AS issue, i.severity,
       COUNT(DISTINCT c) AS affected_customers,
       i.report_count
ORDER BY COUNT(DISTINCT c) DESC

// Customer-Issue heatmap
MATCH (c:Customer)-[a:AFFECTED_BY]->(i:Issue)
RETURN c.canonical_name AS customer, c.segment,
       i.canonical_name AS issue, i.severity,
       a.report_count
ORDER BY a.report_count DESC
```

### 4.4 Path & Relationship Queries

```cypher
// What connects Customer X to Feature Y?
MATCH path = shortestPath(
  (c:Customer {id: $customerId})-[*..4]-(f:Feature {id: $featureId})
)
RETURN path

// Impact analysis: what's affected if we change Feature X?
MATCH (f:Feature {id: $featureId})<-[:DEPENDS_ON*1..3]-(dependent:Feature)
OPTIONAL MATCH (c:Customer)-[:USES]->(dependent)
RETURN dependent.canonical_name AS affected_feature,
       COLLECT(DISTINCT c.canonical_name) AS affected_customers

// Find related issues (same customers, same features)
MATCH (i:Issue {id: $issueId})<-[:AFFECTED_BY]-(c:Customer)-[:AFFECTED_BY]->(related:Issue)
WHERE related.id <> $issueId
RETURN related.canonical_name, COUNT(DISTINCT c) AS shared_customers
ORDER BY shared_customers DESC
LIMIT 10
```

### 4.5 Trend Queries

```cypher
// Emerging issues (increasing report count over last 4 weeks)
MATCH (i:Issue)<-[:DESCRIBES_ISSUE]-(s:Signal)
WHERE s.timestamp > datetime() - duration('P28D')
WITH i, 
     COUNT(CASE WHEN s.timestamp > datetime() - duration('P7D') THEN 1 END) AS week1,
     COUNT(CASE WHEN s.timestamp > datetime() - duration('P14D') AND s.timestamp <= datetime() - duration('P7D') THEN 1 END) AS week2,
     COUNT(CASE WHEN s.timestamp > datetime() - duration('P21D') AND s.timestamp <= datetime() - duration('P14D') THEN 1 END) AS week3,
     COUNT(CASE WHEN s.timestamp > datetime() - duration('P28D') AND s.timestamp <= datetime() - duration('P21D') THEN 1 END) AS week4
WHERE week1 > week2 AND week2 > week3
RETURN i.canonical_name AS issue, i.severity,
       week1, week2, week3, week4,
       toFloat(week1 - week4) / CASE WHEN week4 = 0 THEN 1 ELSE week4 END AS growth_rate
ORDER BY growth_rate DESC
```

---

## 5. Neo4j Configuration

### 5.1 Docker Compose

```yaml
services:
  neo4j:
    image: neo4j:5-community
    ports:
      - "7474:7474"   # HTTP (Browser UI)
      - "7687:7687"   # Bolt (Driver)
    environment:
      NEO4J_AUTH: neo4j/${NEO4J_PASSWORD}
      NEO4J_PLUGINS: '["apoc"]'
      NEO4J_dbms_memory_heap_max__size: 1G
      NEO4J_dbms_memory_pagecache_size: 512M
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs

volumes:
  neo4j_data:
  neo4j_logs:
```

### 5.2 Node.js Driver Setup

```typescript
import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'password'
  )
);

// Health check
export async function checkNeo4jConnection(): Promise<boolean> {
  const session = driver.session();
  try {
    await session.run('RETURN 1');
    return true;
  } finally {
    await session.close();
  }
}
```

---

## 6. Performance Considerations

| Query Type | Expected Latency | Optimization |
|------------|-----------------|--------------|
| Single entity lookup | <10ms | Index on id (constraint) |
| Customer 360 | <100ms | APOC for parallel match |
| Heatmap (full) | <500ms | Pre-computed materialized view for large datasets |
| Path queries (4 hops) | <200ms | Limit traversal depth |
| Trend queries (4 weeks) | <300ms | Index on Signal.timestamp |
| Full resync (10k entities) | <5 min | Batch UNWIND imports |

### 6.1 Indexes

```cypher
CREATE INDEX signal_timestamp IF NOT EXISTS FOR (s:Signal) ON (s.timestamp);
CREATE INDEX signal_source IF NOT EXISTS FOR (s:Signal) ON (s.source);
CREATE INDEX issue_severity IF NOT EXISTS FOR (i:Issue) ON (i.severity);
CREATE INDEX issue_status IF NOT EXISTS FOR (i:Issue) ON (i.status);
CREATE INDEX feature_area IF NOT EXISTS FOR (f:Feature) ON (f.product_area);
CREATE INDEX customer_segment IF NOT EXISTS FOR (c:Customer) ON (c.segment);
CREATE INDEX theme_level IF NOT EXISTS FOR (t:Theme) ON (t.level);
```
