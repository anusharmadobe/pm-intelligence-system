# V2 Entity Resolution — Deep Dive

> **Version:** 2.0
> **Date:** 2026-02-09
> **Status:** Approved for Build
> **Priority:** P0 — This is the core differentiator of the entire system

---

## 1. Why Entity Resolution is Everything

Entity resolution (ER) is the process of determining that "auth timeout", "Authentication Timeout Issue", "login service timeout", and "PROD-1234" all refer to the same underlying issue. Without high-quality ER:

- Heatmaps show 4 separate issues instead of 1 issue with 4x the impact
- Customer impact counts are wrong (under-counting)
- Feature usage data is fragmented
- Trend analysis misses consolidated patterns
- PM trust erodes from the first incorrect answer

**Investment principle:** Spend 30-40% of total V2 engineering time on entity resolution. Everything else is straightforward plumbing by comparison.

---

## 2. Entity Types

| Type | Examples | Challenge Level | Key Matching Signals |
|------|----------|-----------------|---------------------|
| `customer` | "Acme Corp", "Acme", "ACME Inc.", "@john from Acme" | Medium | Company name variants, domain names, contact names |
| `feature` | "auth", "authentication", "SSO", "login", "sign-in" | High | Abbreviations, synonyms, technical vs. user-facing names |
| `issue` | "auth timeout", "login bug", "PROD-1234", "can't sign in" | Very High | Symptom descriptions, JIRA IDs, informal descriptions |
| `theme` | "security concerns", "auth issues", "login problems" | Medium | Existing theme hierarchy helps constrain matching |
| `stakeholder` | "Alice from Engineering", "Alice Chen", "@achen" | Medium | Name variants, usernames, team context |

---

## 3. Architecture

### 3.1 Resolution Pipeline

```
Step 1: BLOCKING (reduce comparison space)
  │ Purpose: Avoid O(n^2) comparisons. Group entities likely to match.
  │
  │ customer:     first_3_chars(normalized_name) + company_domain
  │ feature:      product_area + first_token(name)
  │ issue:        category + severity (if available)
  │ theme:        parent_theme_id
  │ stakeholder:  team + first_name_initial
  │
  │ Output: Candidate pairs (typically reduces comparisons by 95%+)
  ▼
Step 2: MATCHING (multi-signal similarity)
  │ For each candidate pair, compute:
  │
  │ a) String similarity (weight: 0.25)
  │    - Jaro-Winkler distance (good for names)
  │    - Token-level Jaccard similarity (good for phrases)
  │    - Levenshtein on normalized forms
  │
  │ b) Embedding similarity (weight: 0.35)
  │    - Cosine similarity of entity name embeddings (pgvector)
  │    - Optionally: context embeddings (surrounding signal text)
  │
  │ c) LLM-assisted matching (weight: 0.40) — for candidates scoring 0.5-0.85
  │    - Prompt: "Are these the same {entity_type}?
  │      Entity A: '{name_a}' — Context: '{signal_text_a}'
  │      Entity B: '{name_b}' — Context: '{signal_text_b}'
  │      Answer: yes/no, confidence (0-1), reasoning"
  │    - Only invoked for ambiguous pairs (cost optimization)
  │
  │ d) Alias lookup (weight: override)
  │    - If entity matches a known alias → automatic resolve
  │
  │ Combined score = weighted_average(a, b, c) or alias_override
  │
  │ Output: Match scores for all candidate pairs
  ▼
Step 3: CLUSTERING (group matching entities)
  │ Purpose: If A matches B and B matches C, then A, B, C are the same entity.
  │
  │ Algorithm: Connected components with transitive closure
  │ Constraint: All pairwise scores within cluster must exceed 0.5
  │             (prevents chaining through weak matches)
  │
  │ For each cluster:
  │   - Select canonical form (heuristic: longest formal name, or human-confirmed name)
  │   - Record all other forms as aliases
  │
  │ Output: Clusters with canonical entity + aliases
  ▼
Step 4: RESOLUTION DECISION
  │
  │ High confidence (score > ER_AUTO_MERGE_THRESHOLD, default 0.9):
  │   → Auto-merge into canonical entity
  │   → Add aliases to alias_management_service
  │   → Sync to Neo4j knowledge graph
  │   → Log in entity_resolution_log with confidence and reasoning
  │
  │ Medium confidence (ER_REJECT_THRESHOLD < score < ER_AUTO_MERGE_THRESHOLD):
  │   → Queue for human review in feedback_service
  │   → Include: both entity names, source signals, confidence, LLM reasoning
  │   → PM accepts or rejects via Claude Code MCP tool
  │
  │ Low confidence (score < ER_REJECT_THRESHOLD, default 0.3):
  │   → Treat as separate entities
  │   → Create new canonical entity if not seen before
  │   → Log decision for future reference
```

### 3.2 Incremental Resolution

New signals don't require re-resolving all entities:

```
New signal arrives with extracted entity mention "auth timeout bug"
  1. Check alias table: does "auth timeout bug" match any known alias?
     → YES: resolve to canonical entity immediately (fastest path)
     → NO: continue to step 2
  2. Run blocking against existing canonical entities of same type
  3. Run matching against candidate canonical entities
  4. Apply resolution decision (auto-merge / queue / new entity)
```

This means resolution is O(1) for known aliases, and O(k) where k = entities in the same block for new mentions. Full re-resolution is only needed during backfill or after bulk ingestion.

---

## 4. Database Schema

### 4.1 New Tables

```sql
-- Canonical entity registry: the authoritative identity for each entity
CREATE TABLE entity_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,  -- 'customer', 'feature', 'issue', 'theme', 'stakeholder'
  canonical_name TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  confidence FLOAT DEFAULT 1.0,      -- Overall confidence in this entity's identity
  created_by VARCHAR(20) DEFAULT 'system',  -- 'system' or 'human'
  last_validated_by VARCHAR(20),
  last_validated_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_entity_type CHECK (entity_type IN ('customer', 'feature', 'issue', 'theme', 'stakeholder'))
);

CREATE INDEX idx_entity_registry_type ON entity_registry(entity_type);
CREATE INDEX idx_entity_registry_name ON entity_registry(canonical_name);
CREATE INDEX idx_entity_registry_active ON entity_registry(is_active) WHERE is_active = true;

-- Alias table: maps variants to canonical entities
CREATE TABLE entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_entity_id UUID NOT NULL REFERENCES entity_registry(id),
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,     -- lowercased, trimmed, special chars removed
  alias_source VARCHAR(30) NOT NULL,  -- 'extracted', 'human_confirmed', 'llm_inferred', 'manual'
  confidence FLOAT DEFAULT 1.0,
  signal_id UUID REFERENCES signals(id),  -- Which signal first introduced this alias
  confirmed_by_human BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_alias_per_type UNIQUE (alias_normalized, canonical_entity_id)
);

CREATE INDEX idx_entity_aliases_normalized ON entity_aliases(alias_normalized);
CREATE INDEX idx_entity_aliases_entity ON entity_aliases(canonical_entity_id);

-- Entity resolution log: audit trail of all resolution decisions
CREATE TABLE entity_resolution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_mention TEXT NOT NULL,           -- Raw mention from signal
  entity_type VARCHAR(50) NOT NULL,
  signal_id UUID REFERENCES signals(id),
  resolution_result VARCHAR(30) NOT NULL, -- 'auto_merged', 'human_merged', 'human_rejected', 'new_entity', 'alias_matched'
  resolved_to_entity_id UUID REFERENCES entity_registry(id),
  confidence FLOAT NOT NULL,
  match_details JSONB,                    -- Detailed scoring breakdown
  llm_reasoning TEXT,                     -- LLM explanation (if LLM was used)
  resolved_by VARCHAR(20) DEFAULT 'system',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_er_log_signal ON entity_resolution_log(signal_id);
CREATE INDEX idx_er_log_entity ON entity_resolution_log(resolved_to_entity_id);
CREATE INDEX idx_er_log_result ON entity_resolution_log(resolution_result);

-- Entity merge history: tracks merges and splits for audit
CREATE TABLE entity_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(10) NOT NULL,  -- 'merge' or 'split'
  surviving_entity_id UUID NOT NULL REFERENCES entity_registry(id),
  absorbed_entity_id UUID,      -- The entity that was merged in (NULL for splits)
  new_entity_id UUID,           -- The new entity created (for splits)
  performed_by VARCHAR(20) DEFAULT 'system',
  reasoning TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4.2 Linking Extracted Mentions to Canonical Entities

```sql
-- Extend signal_extractions to link to canonical entities
ALTER TABLE signal_extractions 
  ADD COLUMN canonical_entity_id UUID REFERENCES entity_registry(id),
  ADD COLUMN resolution_confidence FLOAT,
  ADD COLUMN resolution_method VARCHAR(30); -- 'alias_match', 'auto_merge', 'human_confirmed'
```

---

## 5. pyJedAI Integration

### 5.1 Python Microservice

```
Location: python_services/entity_resolution/
├── app.py                   # FastAPI app
├── resolver.py              # Core resolution logic using pyJedAI
├── blocking.py              # Custom blocking strategies per entity type
├── matching.py              # Multi-signal matching (string + embedding + LLM)
├── llm_matcher.py           # LLM-assisted matching for ambiguous pairs
├── requirements.txt         # pyjedai, fastapi, uvicorn, sentence-transformers, httpx
└── tests/
    ├── test_resolver.py
    ├── test_blocking.py
    └── golden_dataset.json  # Known entity pairs for accuracy benchmarking
```

### 5.2 API Contract

```
POST /resolve
  Request:
    {
      "entity_type": "customer",
      "mention": "Acme Corp",
      "context": "Signal text where Acme Corp was mentioned...",
      "signal_id": "uuid",
      "existing_entities": [...]  // Optional: pass candidates to match against
    }
  Response:
    {
      "status": "resolved" | "needs_review" | "new_entity",
      "canonical_id": "uuid" | null,
      "canonical_name": "Acme Corporation" | null,
      "confidence": 0.94,
      "match_details": {
        "string_similarity": 0.88,
        "embedding_similarity": 0.92,
        "llm_confidence": 0.97,
        "method": "auto_merge"
      },
      "aliases_to_add": ["Acme Corp"],
      "candidates": [...]  // If needs_review: top candidates with scores
    }

POST /resolve-batch
  Request:
    {
      "mentions": [
        { "entity_type": "customer", "mention": "Acme Corp", "context": "...", "signal_id": "uuid" },
        { "entity_type": "feature", "mention": "auth service", "context": "...", "signal_id": "uuid" }
      ]
    }
  Response:
    {
      "results": [...],  // Array of resolution results
      "stats": { "auto_merged": 8, "needs_review": 2, "new_entities": 1, "alias_matched": 4 }
    }

GET /health
  Response: { "status": "ok", "entities_loaded": 1234, "aliases_loaded": 5678 }
```

### 5.3 Entity Registry Cache

The Python service loads the entity registry and alias table into memory on startup and refreshes periodically (every 5 minutes). This ensures fast lookups without hitting the database on every resolution request.

---

## 6. LLM-Assisted Matching Prompts

### 6.1 Entity Comparison Prompt

```
You are an entity resolution expert for a Product Management intelligence system.

Determine if these two mentions refer to the SAME {entity_type}.

Entity A: "{name_a}"
  Source: {source_a}
  Context: "{signal_text_a}"
  
Entity B: "{name_b}"
  Source: {source_b}
  Context: "{signal_text_b}"

Consider:
- Are they describing the same {entity_type}?
- Could the naming differences be explained by abbreviations, informal language, or different contexts?
- Does the surrounding context suggest they refer to the same thing or different things?

Respond in JSON:
{
  "same_entity": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}
```

### 6.2 Cost Optimization

LLM matching is only invoked when:
1. String + embedding similarity is between 0.5 and 0.85 (ambiguous zone)
2. No exact alias match exists
3. The entity type is high-value (customer, feature) — for themes, rely more on hierarchy

Expected volume: ~10-20% of entity mentions need LLM matching. At GPT-4o-mini pricing (~$0.15/1M input tokens), this costs <$1/day for a typical PM workload.

---

## 7. Feedback-Driven Improvement

### 7.1 Learning from Human Corrections

```
Human accepts merge of "auth timeout" → "Authentication Timeout Issue"
  → alias "auth timeout" added with confirmed_by_human = true
  → Next time "auth timeout" appears: alias match (no resolution needed)
  → Over time: alias table grows, fewer ambiguous cases

Human rejects merge of "login page" and "authentication service"
  → Pattern logged: "login page" (UI component) ≠ "authentication service" (backend)
  → After 10+ similar rejections: extraction prompt updated to distinguish UI vs. backend

Human splits wrongly merged entities
  → Both entities restored
  → Merged alias removed
  → Pattern logged for future matching constraint
```

### 7.2 Accuracy Tracking

```sql
-- Track resolution accuracy over rolling windows
CREATE VIEW entity_resolution_accuracy AS
SELECT
  date_trunc('week', erl.created_at) AS week,
  erl.entity_type,
  COUNT(*) AS total_resolutions,
  COUNT(*) FILTER (WHERE erl.resolution_result = 'auto_merged') AS auto_merged,
  COUNT(*) FILTER (WHERE erl.resolution_result = 'human_merged') AS human_confirmed,
  COUNT(*) FILTER (WHERE erl.resolution_result = 'human_rejected') AS human_rejected,
  COUNT(*) FILTER (WHERE erl.resolution_result = 'alias_matched') AS alias_matched,
  COUNT(*) FILTER (WHERE erl.resolution_result = 'new_entity') AS new_entities,
  -- Accuracy: (auto_merged that weren't later split + human_confirmed) / total
  ROUND(
    (COUNT(*) FILTER (WHERE erl.resolution_result IN ('auto_merged', 'alias_matched', 'human_merged'))::FLOAT 
     / NULLIF(COUNT(*), 0)) * 100, 2
  ) AS auto_accuracy_pct
FROM entity_resolution_log erl
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

### 7.3 Prompt Improvement Cycle

```
Trigger: >50 human corrections of same entity_type in 30 days
Process:
  1. Collect all corrections for that entity type
  2. Categorize correction patterns:
     - Abbreviation misses (e.g., "auth" ≠ "authorization" when context says authentication)
     - Scope confusion (e.g., UI component vs. backend service)
     - Customer name variants (e.g., legal name vs. informal name)
  3. Generate improved extraction prompt with examples from corrections
  4. Test new prompt on next 100 signals alongside old prompt
  5. If new prompt accuracy > old by 5%+: adopt, archive old
  6. Log prompt version change in audit trail
```

---

## 8. Golden Dataset for Benchmarking

Maintain a golden dataset of known entity pairs for regression testing:

```json
{
  "golden_pairs": [
    {
      "entity_type": "customer",
      "mention_a": "Acme Corp",
      "mention_b": "Acme Corporation",
      "expected": "same",
      "difficulty": "easy"
    },
    {
      "entity_type": "feature",
      "mention_a": "SSO integration",
      "mention_b": "single sign-on",
      "expected": "same",
      "difficulty": "medium"
    },
    {
      "entity_type": "issue",
      "mention_a": "login page is slow",
      "mention_b": "authentication service timeout",
      "expected": "different",
      "difficulty": "hard"
    }
  ]
}
```

Run benchmarks weekly. Track accuracy by difficulty level. Regressions block deployment.

---

## 9. Edge Cases & Conflict Resolution

### 9.1 Multiple High-Confidence Matches

**Problem:** Entity "auth service" matches both "Authentication Service" (0.93) and "Authorization Service" (0.91). Which wins?

**Resolution strategy:**
```
1. If confidence difference > 0.1: choose highest confidence match
2. If confidence difference ≤ 0.1 (close race):
   a. Check alias table: if mention matches a confirmed alias of either → use that entity
   b. Check context: include surrounding signal text in LLM disambiguation prompt:
      "Does 'auth service' in context '...' refer to Authentication or Authorization?"
   c. If still ambiguous: queue for human review with BOTH candidates shown
   d. Never auto-merge ambiguous multi-matches
```

### 9.2 LLM Service Unavailability

**Problem:** Azure OpenAI is down. Entity resolution can't use LLM matching.

**Fallback chain:**
```
Normal mode:    Alias lookup → String similarity → Embedding similarity → LLM matching
Degraded mode:  Alias lookup → String similarity → Embedding similarity → QUEUE for later

When LLM unavailable (circuit breaker OPEN):
  - High string+embedding score (>0.92): auto-merge (LLM would likely agree)
  - Medium score (0.5-0.92): queue ALL for human review (wider range than normal)
  - Low score (<0.5): treat as new entity
  - Log: "LLM matching unavailable; resolution quality degraded"
  - When LLM recovers: re-process queued items with full pipeline
```

### 9.3 Cluster Repair (Incremental Correction)

**Problem:** Entity resolution is order-dependent. If "Acme" is wrongly merged with "Acuma" early on, all subsequent Acme signals get mislinked.

**Repair mechanism (inspired by FAMER framework):**
```
1. DETECTION: After every 100 new entity resolutions, run lightweight cluster validation:
   - For each canonical entity with >5 aliases:
     - Compute pairwise embedding similarity between ALL aliases
     - If any alias pair has similarity < 0.4: flag cluster for review
   - For each canonical entity with signals from multiple sources:
     - Check if signal contexts are semantically coherent
     - If intra-cluster coherence < 0.5: flag for review

2. REPAIR:
   - Flagged clusters go to feedback_service as 'cluster_review' feedback type
   - PM can: confirm cluster is correct, OR split into 2+ entities
   - On split: signals re-linked, aliases redistributed, Neo4j updated

3. PREVENTION:
   - Transitive closure constraint: when A→B and B→C merge is proposed,
     verify A↔C similarity is also above threshold (not just A↔B and B↔C)
   - If A↔C similarity is below 0.4: block transitive merge, queue for review
```

### 9.4 Entity Type Misclassification

**Problem:** "Dashboard" extracted as a feature, but in context it's an issue ("dashboard is broken").

**Solution:**
```
1. LLM extraction prompt explicitly requires entity_type classification with reasoning
2. Post-extraction validation: check if entity name + context makes sense for classified type
   - "dashboard is broken" + type "feature" → suspicious → re-classify with focused prompt
3. If reclassification changes type: check if entity already exists under correct type
4. Add misclassification as feedback type for learning
```

### 9.5 Handling Entity Splits After Signals Linked

**Problem:** Entities A and B were merged. 50 signals were linked to the merged entity. PM later says "these are different" — split needed.

**Split procedure:**
```
1. Create new canonical entity B' (restored from merge history)
2. For each signal linked to merged entity:
   a. Re-run extraction on signal to determine which entity the mention refers to
   b. Use LLM: "Does '{mention}' in context '{signal_text}' refer to A or B'?"
   c. Re-link signal to correct entity
3. Update Neo4j: remove old relationships, create corrected ones
4. Update alias table: redistribute aliases between A and B'
5. Record split in entity_merge_history
6. This is expensive — warn PM before executing (via MCP tool response)
```

### 9.6 Deactivated Alias Handling

**Problem:** Alias "auth" was deactivated (previously mapped to "Authentication Service"). New signal mentions "auth".

**Behavior:**
```
- Deactivated aliases are SKIPPED during alias lookup (no automatic match)
- The mention goes through full resolution pipeline (string + embedding + LLM)
- If resolution produces same result: alias is re-activated automatically
- If resolution produces different result: new alias created for new entity
- Deactivation history preserved in alias table for audit
```

### 9.7 Blocking Strategy When Metadata is Missing

**Problem:** New issue has no category or severity (blocking key is "category + severity").

**Fallback blocking strategy per entity type:**
```
customer:
  Primary:   first_3_chars(name) + domain
  Fallback:  first_3_chars(name) only (broader block, more comparisons)

feature:
  Primary:   product_area + first_token(name)
  Fallback:  first_token(name) only

issue:
  Primary:   category + severity
  Fallback:  first_2_tokens(name) (when category/severity unknown)
  Fallback2: ALL issues in same source (expensive, for truly unknown issues)

theme:
  Primary:   parent_theme_id
  Fallback:  theme_level + first_token(name)

stakeholder:
  Primary:   team + first_initial
  Fallback:  first_initial + last_name_prefix
```

### 9.8 Large-Scale Batch Resolution

**Problem:** Backfilling 10,000 existing signals through entity resolution.

**Batching strategy:**
```
1. Group signals by source and date (process chronologically per source)
2. Process in batches of 50 signals
3. Within each batch:
   a. Extract all entity mentions
   b. Resolve mentions against current entity registry (grows as batch progresses)
   c. Commit batch results to PostgreSQL + Neo4j
4. Between batches: refresh in-memory entity registry cache
5. After full backfill: run cluster repair validation
6. Expected throughput: ~500 signals/hour (with LLM matching)
7. Without LLM matching (degraded mode): ~2000 signals/hour
```

---

## 10. Performance Targets

| Metric | Target |
|--------|--------|
| Alias match latency | <10ms |
| Single entity resolution (with LLM) | <3 seconds |
| Single entity resolution (without LLM, degraded) | <500ms |
| Batch resolution (100 entities) | <30 seconds |
| Batch resolution (1000 entities, backfill) | <5 minutes |
| Auto-merge accuracy (30 day) | >85% |
| Auto-merge accuracy (90 day) | >92% |
| False positive rate (wrong merges) | <5% (30d), <2% (90d) |
| False negative rate (missed merges) | <15% (30d), <8% (90d) |
| Alias table coverage | >80% of recurring mentions after 30 days |
| Cluster repair detection rate | >90% of incorrect merges detected within 7 days |
| LLM fallback graceful degradation | 0% data loss when LLM unavailable |
