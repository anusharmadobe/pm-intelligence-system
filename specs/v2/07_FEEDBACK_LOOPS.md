# V2 Feedback Loops — Human-in-the-Loop Learning

> **Version:** 2.3 (Updated — agent output feedback loop, agent versioning feedback, completeness gaps addressed)
> **Date:** 2026-02-09
> **Status:** Approved for Build

---

## 1. Philosophy

The system gets better the more it is used. Every correction, confirmation, and rejection is a learning signal that improves future accuracy. This is the compound interest of the PM Intelligence System.

**Feedback is not a bug fix — it's the product.**

### 1.1 Feedback by Persona

| Persona | Feedback Role | Typical Actions | Expected Volume |
|---------|--------------|-----------------|-----------------|
| **PM (Daily Driver)** | Primary feedback provider | Entity reviews, extraction corrections, classification fixes | 5–15 items/day |
| **PM Leader (Strategist)** | Occasional feedback on strategic entities | Entity importance override, priority corrections | 1–3 items/week |
| **New PM (Ramp-Up)** | Learning consumer, not yet a reliable feedback source | May flag confusion about entity vocabulary — treated as low-confidence feedback until the PM gains context | Low (first 2 weeks) |

**Design implication:** Feedback from the PM (Daily Driver) is treated as high-authority. PM Leader overrides are treated as higher-authority. New PM feedback is flagged for review by the primary PM until the New PM is ramped up (configurable threshold: 2 weeks or 20 accepted corrections).

---

## 2. Feedback Types

| Type | Trigger | PM Action | System Learning |
|------|---------|-----------|-----------------|
| `entity_merge` | System proposes two entities are the same | Accept/Reject | Alias added if accepted; negative pattern if rejected |
| `entity_split` | PM discovers wrongly merged entities | Initiate split | Remove incorrect alias, re-link signals |
| `entity_rename` | Canonical name is wrong or suboptimal | Provide correct name | Update canonical name, keep old as alias |
| `classification_correction` | Signal classified under wrong theme/category | Correct classification | Improve classification prompt |
| `extraction_correction` | LLM extracted wrong entity from signal | Correct extraction | Improve extraction prompt |
| `false_positive` | Entity was incorrectly identified in signal | Mark as false positive | Add to negative examples in prompt |
| `missing_entity` | PM notices an entity the system missed | Add missing entity | Add to positive examples in prompt |
| `relevance_feedback` | Signal marked as relevant/irrelevant | Thumbs up/down | Adjust relevance thresholds |
| `severity_correction` | Issue severity is wrong | Correct severity | Calibrate severity classification |
| `entity_description_correction` | Entity description is wrong or incomplete | Provide correct description | Update entity registry |
| `signal_is_noise` | Signal is irrelevant spam/noise | Mark as noise | Add to noise patterns for filtering |
| `cluster_review` | Canonical entity cluster seems incoherent | Confirm or split cluster | Improve transitive closure constraints |
| `entity_type_correction` | Entity classified as wrong type (feature vs. issue) | Correct type | Improve extraction type classification |
| `agent_output_correction` | Agent produced incorrect output (wrong urgency, bad classification, incorrect report) | PM corrects agent output | Improve agent prompt/logic; track per-agent accuracy |
| `agent_output_approval` | Agent output is correct | PM confirms | Positive signal for agent quality tracking |
| `agent_proposal_review` | Agent proposed entity change, PM reviews | Accept/Reject/Modify | Direct feedback on agent proposal quality |

---

### 2.1 Agent Output Feedback Loop

**Problem solved:** Agents (e.g., Triage Agent, Competitive Intel Agent) make autonomous classifications and generate outputs. Without a feedback loop, PMs have no way to correct agent mistakes, and agents can't improve.

**Design:**

```
Agent produces output → Output stored with agent_id + output_type
       ↓
PM reviews output (via MCP: review_agent_outputs tool)
       ↓
PM accepts, corrects, or rejects → feedback_log entry created
       ↓
Feedback aggregated per agent → agent accuracy metrics updated
       ↓
If accuracy drops below SLO → alert + agent circuit breaker consideration
       ↓
Feedback patterns analyzed → agent prompts/logic updated (manual, V2)
                            → agent self-tuning (V3, with learning agents)
```

**Feedback types by agent:**

| Agent | Output Type | What PM Reviews | Feedback Impact |
|-------|-------------|-----------------|-----------------|
| **Triage Agent** | Signal urgency classification (P0/P1/P2) | "Was this really P0?" | Corrects urgency thresholds; affects future triage |
| **Report Scheduler** | Generated report content | "This weekly digest missed key trend X" | Improves report templates; adjusts content selection |
| **Competitive Intel** | Competitor mention extraction | "This isn't a competitor, it's a partner" | Refines competitor entity list; improves extraction |
| **Data Quality Agent** | Orphaned entity proposals | "This entity isn't orphaned, signals are just sparse" | Adjusts orphan detection thresholds |
| **Customer Success Agent** | Customer health decline brief | "Health score drop was a one-time event, not a trend" | Improves decline detection window |

**MCP tool (new):**

```
Tool: review_agent_outputs
Params: { agent_name?: string, output_type?: string, status?: 'pending_review' }
Returns: List of agent outputs awaiting PM review, grouped by agent
Action: PM can accept, correct (with correction text), or reject each output
```

**Schema extension (feedback_log):**

```sql
-- Additional columns for agent output feedback
ALTER TABLE feedback_log ADD COLUMN source_agent_id UUID REFERENCES agent_registry(id);
ALTER TABLE feedback_log ADD COLUMN agent_output_type VARCHAR(50);
-- e.g., 'urgency_classification', 'report_content', 'competitor_extraction',
--       'orphan_detection', 'health_decline_brief'

-- Update feedback_type constraint to include new types
ALTER TABLE feedback_log DROP CONSTRAINT valid_feedback_type;
ALTER TABLE feedback_log ADD CONSTRAINT valid_feedback_type CHECK (feedback_type IN (
  'entity_merge', 'entity_split', 'entity_rename',
  'classification_correction', 'extraction_correction',
  'false_positive', 'missing_entity', 'relevance_feedback',
  'severity_correction', 'entity_description_correction',
  'signal_is_noise', 'cluster_review', 'entity_type_correction',
  'agent_output_correction', 'agent_output_approval', 'agent_proposal_review'
));
```

**Agent accuracy tracking (derived from feedback):**

```sql
-- View: per-agent accuracy over rolling 30-day window
CREATE VIEW agent_accuracy_30d AS
SELECT
  source_agent_id,
  agent_output_type,
  COUNT(*) FILTER (WHERE feedback_type = 'agent_output_approval') AS approved,
  COUNT(*) FILTER (WHERE feedback_type = 'agent_output_correction') AS corrected,
  COUNT(*) AS total_reviewed,
  ROUND(
    COUNT(*) FILTER (WHERE feedback_type = 'agent_output_approval')::numeric /
    NULLIF(COUNT(*), 0) * 100, 1
  ) AS accuracy_pct
FROM feedback_log
WHERE source_agent_id IS NOT NULL
  AND created_at > NOW() - INTERVAL '30 days'
  AND status IN ('accepted', 'rejected')
GROUP BY source_agent_id, agent_output_type;
```

---

## 3. Feedback Service Design

### 3.1 Database Schema

```sql
-- Core feedback table
CREATE TABLE feedback_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'accepted', 'rejected', 'deferred'
  
  -- What the system produced
  system_output JSONB NOT NULL,
  -- Contains: entity_id, extraction_id, signal_id, original_value, confidence, etc.
  
  -- What the human says is correct (populated when resolved)
  human_correction JSONB,
  -- Contains: corrected_value, reasoning, etc.
  
  -- Resolution metadata
  resolved_by VARCHAR(100),        -- PM identifier
  resolved_at TIMESTAMP,
  resolution_notes TEXT,
  
  -- System confidence at time of output
  system_confidence FLOAT NOT NULL,
  
  -- Impact tracking
  signals_affected INTEGER DEFAULT 0,
  entities_affected INTEGER DEFAULT 0,
  
  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_feedback_type CHECK (feedback_type IN (
    'entity_merge', 'entity_split', 'entity_rename', 
    'classification_correction', 'extraction_correction',
    'false_positive', 'missing_entity', 'relevance_feedback',
    'severity_correction'
  )),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'accepted', 'rejected', 'deferred'))
);

CREATE INDEX idx_feedback_status ON feedback_log(status);
CREATE INDEX idx_feedback_type ON feedback_log(feedback_type);
CREATE INDEX idx_feedback_created ON feedback_log(created_at);

-- Prompt versioning: track prompt changes driven by feedback
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_name VARCHAR(100) NOT NULL,      -- 'entity_extraction', 'entity_matching', 'classification'
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  change_reason TEXT,                      -- "Added 15 abbreviation examples from feedback corrections"
  feedback_ids UUID[],                     -- Which feedback items drove this change
  accuracy_before FLOAT,
  accuracy_after FLOAT,                    -- Measured after A/B test
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_prompt_version UNIQUE (prompt_name, version)
);
```

### 3.2 API Endpoints

```
GET  /api/feedback/pending                         -- All pending feedback items
GET  /api/feedback/pending?type=entity_merge       -- Filter by type
GET  /api/feedback/pending?type=entity_merge&limit=5  -- Paginate

POST /api/feedback/:id/accept                      -- Accept system suggestion
  Body: { notes?: string }

POST /api/feedback/:id/reject                      -- Reject with optional correction
  Body: { corrected_value?: any, notes?: string }

POST /api/feedback/:id/defer                       -- Defer decision
  Body: { reason?: string }

POST /api/feedback/bulk-accept                     -- Accept multiple high-confidence items
  Body: { feedback_ids: string[], notes?: string }

POST /api/feedback/create                          -- PM creates feedback proactively
  Body: {
    feedback_type: string,
    signal_id?: string,
    entity_id?: string,
    description: string,
    corrected_value?: any
  }

GET  /api/feedback/stats                           -- Accuracy metrics
GET  /api/feedback/stats/trend                     -- Accuracy over time
GET  /api/feedback/prompts                         -- Active prompt versions
```

---

## 4. Feedback Workflows

### 4.1 Entity Merge Review

```
1. Entity resolution finds "Acme Corp" matches "Acme Corporation" at 0.82 confidence
2. Since 0.6 < 0.82 < 0.9: create feedback_log entry:
   {
     feedback_type: "entity_merge",
     status: "pending",
     system_output: {
       entity_a: { id: "uuid-a", name: "Acme Corp", source_signal: "signal-123" },
       entity_b: { id: "uuid-b", name: "Acme Corporation", source_signal: "signal-456" },
       match_scores: {
         string_similarity: 0.91,
         embedding_similarity: 0.78,
         llm_confidence: 0.82,
         combined: 0.82
       },
       llm_reasoning: "Both appear to refer to the same company..."
     },
     system_confidence: 0.82
   }

3. PM queries pending reviews via Claude Code:
   PM: "Any entity reviews I should look at?"
   Claude → MCP tool: review_pending_entities()
   Returns: "1 pending: Should 'Acme Corp' merge with 'Acme Corporation'? (82% confidence)"

4a. PM: "Yes, merge them"
    Claude → MCP tool: confirm_entity_merge(feedback_id)
    System:
      - Updates feedback_log: status = 'accepted'
      - Merges entities in entity_registry
      - Adds "Acme Corp" as alias with confirmed_by_human = true
      - Updates Neo4j graph
      - Re-links all signals from entity_a to surviving entity

4b. PM: "No, these are different companies"
    Claude → MCP tool: reject_entity_merge(feedback_id, notes="Acme Corp is the subsidiary")
    System:
      - Updates feedback_log: status = 'rejected', notes recorded
      - Entities remain separate
      - Logs negative pattern for future matching
```

### 4.2 Extraction Correction

```
1. PM finds that signal "The login page is loading slowly" was tagged as issue "Authentication Timeout"
   But it's actually a different issue: "Login Page Performance"

2. PM: "Signal X was tagged with the wrong issue. It should be 'Login Page Performance'"
   Claude → MCP tool: create_feedback(
     type='extraction_correction',
     signal_id='signal-789',
     description='Tagged as Authentication Timeout but should be Login Page Performance',
     corrected_value={ issue_name: 'Login Page Performance' }
   )

3. System:
   - Creates feedback_log entry with correction
   - Updates signal_extractions to correct the entity link
   - Updates Neo4j graph (remove old relationship, add new)
   - Logs pattern: "login page" ≠ "authentication" in performance context
```

### 4.3 Missing Entity

```
1. PM notices that "Enterprise SSO" is being missed as a feature in meeting transcripts

2. PM: "The system is missing 'Enterprise SSO' as a feature. Add it."
   Claude → MCP tool: add_entity_alias(
     entity_name='Single Sign-On',
     entity_type='feature',
     alias='Enterprise SSO'
   )

3. System:
   - Adds alias "Enterprise SSO" → canonical "Single Sign-On"
   - Re-scans recent signals for mentions of "Enterprise SSO"
   - Updates Neo4j graph with newly discovered relationships
```

---

## 5. Feedback-Driven Prompt Improvement

### 5.1 Automatic Improvement Cycle

```
Trigger Condition:
  ≥30 corrections of same feedback_type in trailing 30 days

Process:
  1. ANALYZE corrections
     - Group corrections by pattern (e.g., "abbreviation misses", "scope confusion")
     - Identify top 5 most common correction patterns
     - Extract concrete examples from corrections
     
  2. GENERATE improved prompt
     - Current prompt + correction examples → LLM generates improved prompt
     - Include 5-10 concrete examples from real corrections as few-shot examples
     - Explicitly address top correction patterns in instructions
     
  3. TEST new prompt (A/B comparison)
     - Run BOTH old and new prompt on next 50 signals
     - Compare extraction quality (against entity_registry as ground truth)
     - Compare with any available human-corrected extractions
     
  4. EVALUATE
     - If new prompt accuracy > old by ≥5%: mark as candidate
     - If new prompt accuracy ≤ old: discard, log why
     
  5. ADOPT (with human approval)
     - Create prompt_versions entry
     - Flag for PM review: "New extraction prompt available. Accuracy: 89% → 94%. Review?"
     - PM approves → activate new prompt
     - PM rejects → keep old, log reason

Frequency: Evaluated weekly (Sunday night batch job)
```

### 5.2 What We Track

```typescript
interface FeedbackAnalytics {
  // Per entity type
  entity_resolution_accuracy: {
    auto_merge_accuracy: number;           // % of auto-merges that haven't been split
    human_review_rate: number;              // % of resolutions needing human review
    weekly_trend: number[];                 // Last 8 weeks
  };
  
  // Per correction type
  correction_patterns: {
    type: string;
    count_last_30_days: number;
    top_patterns: string[];                 // "abbreviation", "scope confusion", etc.
    examples: CorrectionExample[];
  }[];
  
  // Prompt versions
  active_prompts: {
    prompt_name: string;
    version: number;
    accuracy: number;
    last_updated: Date;
    corrections_since_update: number;       // How many corrections since this version
  }[];
  
  // Overall
  total_feedback_items: number;
  resolved_this_week: number;
  pending_count: number;
  avg_resolution_time_hours: number;
  system_improving: boolean;                // Is accuracy trending up?
}
```

---

## 6. Feedback UI via MCP (V2)

For V2, all feedback interaction happens through Claude Code/Cowork MCP tools. No separate UI.

### 6.1 Daily Quick Review (5 minutes)
**Personas:** PM (Daily Driver)

```
PM: "Good morning. Any entity reviews for me?"

Claude (via MCP): "You have 7 pending entity reviews:
  - 4 high-confidence (0.85-0.89): customer name variants
  - 2 medium-confidence (0.70-0.80): feature matching
  - 1 low-confidence (0.62): issue classification
  
  Want me to show the high-confidence ones for quick batch approval?"

PM: "Yes, show them"

Claude: "Here are the 4 high-confidence matches:
  1. 'BigCorp Inc' → 'BigCorp Inc.' (0.89) — only difference is period
  2. 'Acme Support Team' → 'Acme Corporation' (0.87) — same company, different reference
  3. 'DataFlow' → 'DataFlow Systems' (0.88) — short name vs. full name
  4. 'TechStart' → 'TechStart.io' (0.85) — company vs. domain name
  
  Approve all 4?"

PM: "Approve 1, 3, 4. Reject 2 — Acme Support Team is actually a team name, not the company."

Claude: "Done. 3 merged, 1 rejected with your note. 
  Entity resolution accuracy this week: 91% (up from 88% last week).
  3 medium-confidence items remaining. Want to review?"
```

### 6.2 Batch Review Session (15–20 minutes)
**Personas:** PM (Daily Driver — weekly deep review)

When the entity review queue grows (15+ items), a structured batch session is more efficient. This is the UX pattern from `10_UX_DESIGN.md` §2.7, described here from the feedback system's perspective.

**Batch Review Protocol:**

```
1. GROUP items by confidence tier:
   - High (≥0.85): Auto-approvable — PM scans for exceptions
   - Medium (0.60–0.84): Needs judgment — system provides context + recommendation
   - Low (<0.60): Likely different — PM usually just confirms rejection

2. PRESENT each tier as a batch:
   - High tier: Show all items, offer "approve all" with exception flagging
   - Medium tier: Show one at a time with:
     a. Match details (scores, reasoning)
     b. Surrounding signal context for both entities
     c. System recommendation ("My take: probably SAME/DIFFERENT because...")
   - Low tier: Show all, offer "reject all" with exception flagging

3. PROCESS actions in bulk:
   - POST /api/feedback/bulk-accept { feedback_ids: [...], notes: "batch approved" }
   - POST /api/feedback/bulk-reject { feedback_ids: [...], notes: "batch rejected" }
   - Individual items reviewed one-at-a-time

4. REPORT results at end of session:
   - Items resolved in this session
   - Updated accuracy metrics
   - Remaining queue size
   - Estimated next session needed (based on ingestion rate)
```

**Efficiency target:** Batch review should resolve 20+ items in 15 minutes (vs. 20+ minutes for one-at-a-time).

### 6.3 New PM Feedback Onboarding
**Personas:** New PM (Ramp-Up)

New PMs need to learn the entity vocabulary before their feedback is reliable. During the first 2 weeks:

```
1. NEW PM REVIEWS ARE FLAGGED:
   - feedback_log entries from New PMs get: { source_persona: 'new_pm', authority: 'low' }
   - These do NOT auto-execute — they queue for primary PM confirmation
   - Exception: High-confidence approvals (>0.88) execute immediately

2. LEARNING MODE:
   When a New PM reviews an entity:
   
   New PM: "Is 'SSO' the same as 'Single Sign-On'?"
   
   Claude: "Yes! The system already has 'SSO' as an alias for 'Single Sign-On'.
     Here's how the entity vocabulary works:
     - Each entity has a canonical name (e.g., 'Single Sign-On')
     - And aliases (e.g., 'SSO', 'SAML auth', 'enterprise login')
     - You can always ask me to 'show the glossary' for any product area."

3. GRADUATION:
   After 20 accepted corrections (verified against primary PM's decisions):
   - New PM's authority upgrades to 'standard'
   - Their feedback executes without confirmation queue
   - System logs: "PM [name] graduated from onboarding mode"
```

### 6.4 PM Leader Feedback Override
**Personas:** PM Leader (Strategist)

PM Leaders occasionally need to override entity decisions at a strategic level:

```
PM Leader: "Merge all variants of 'Authentication' into one entity. 
            It doesn't matter whether it's login, SSO, or MFA — for strategic 
            planning they're all the same initiative."

Claude: "I'll create a parent entity 'Authentication Platform' that groups:
  - 'Authentication Service' (12 signals)
  - 'Single Sign-On' (8 signals)
  - 'Multi-Factor Authentication' (5 signals)
  - 'Login Page' (3 signals)
  
  The individual entities will remain for operational queries, but strategic
  reports and heatmaps will roll up to 'Authentication Platform'.
  
  This is a strategic grouping — it won't affect day-to-day entity resolution."

System:
  - Creates a GROUPS_INTO relationship in Neo4j
  - Strategic queries (heatmaps, roadmap priorities) use the grouped entity
  - Operational queries (customer deep-dives, signal search) use individual entities
  - feedback_log: { source_persona: 'pm_leader', authority: 'high', type: 'strategic_grouping' }
```

---

## 7. Feedback Conflict Resolution

### 7.1 Contradictory Feedback

**Problem:** PM accepts entity merge on Monday, then requests split of same entities on Wednesday.

**Resolution:**
```
1. The split request takes precedence (it's the latest human judgment)
2. The original merge feedback_log entry is NOT modified (immutable audit)
3. A new feedback_log entry is created with type 'entity_split'
4. The entry references the original merge: { "reverses_feedback_id": "uuid" }
5. System executes the split (see 03_ENTITY_RESOLUTION.md Section 9.5)
6. Learning impact: This pair is now in the "negative examples" list —
   the system will NEVER auto-propose this merge again
```

### 7.2 Feedback Staleness

**Problem:** 50 pending feedback items accumulate because PM doesn't review.

**Handling:**
```
1. After 7 days pending: status changed to 'stale', priority increased
2. After 14 days pending: auto-resolve high-confidence items (>0.88):
   - Auto-accept merges with confidence >0.88
   - Log as 'auto_resolved_stale' (not 'accepted' — distinguishable in audit)
3. After 30 days pending: notify PM via MCP system_health tool
   "30 pending entity reviews older than 30 days. System accuracy may be degrading."
4. NEVER auto-resolve medium or low confidence items — they always need human judgment
```

### 7.3 Feedback Priority Scoring

Feedback items are prioritized for PM review:

```
priority = base_priority * recency_weight * impact_weight

base_priority:
  entity_merge (customer): 10  (customers are highest value)
  entity_merge (feature): 8
  entity_merge (issue): 7
  classification_correction: 5
  other: 3

recency_weight: 1.0 + (0.1 * days_pending)  // Older items get higher priority

impact_weight:
  signals_affected > 10: 2.0
  signals_affected > 5: 1.5
  signals_affected > 0: 1.0
```

Items returned by `review_pending_entities` are sorted by priority descending.

---

## 8. Future: Argilla Integration (V3)

For V3 (multi-PM, multi-persona), consider Argilla for:
- Shared annotation workspace across multiple PMs
- Inter-annotator agreement tracking (critical when multiple PMs provide conflicting feedback)
- Active learning workflows
- Dataset versioning
- Direct integration with model fine-tuning pipelines
- Role-based annotation: PM Leader annotations carry higher weight than IC PM annotations

**Multi-persona V3 considerations:**
- Feedback authority hierarchy: PM Leader > PM (Daily Driver) > New PM (Ramp-Up)
- When PM Leader and IC PM disagree, PM Leader's decision wins with notification to IC PM
- Cross-product area entity conflicts (same entity claimed differently by two PMs) escalate to PM Leader
- New PM onboarding analytics: track graduation rate, accuracy during ramp-up, time-to-reliable-feedback

Argilla deployment: Docker container alongside existing services. Free, Apache 2.0.
