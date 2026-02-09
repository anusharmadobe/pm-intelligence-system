# V2 Data Contracts — Non-Negotiable Rules

> **Version:** 2.5 (Updated — comprehensive input/output validation rules across all system surfaces)
> **Date:** 2026-02-09
> **Status:** Approved for Build
> **Extends:** specs/data_contracts.md (V1)

---

## 1. V1 Contracts (Still In Force)

These contracts from V1 remain non-negotiable:

1. **Signals are immutable.** Once stored, a signal's content is never modified.
2. **Signals never contain summaries or insights.** Signals are raw input only.
3. **Opportunities reference multiple signals.** An opportunity without signals is invalid.
4. **Judgments are append-only.** Judgments are never overwritten, only superseded.
5. **Artifacts require a judgment_id.** No artifact without a judgment.
6. **LLM output is never stored as signals.** LLM outputs go to extractions, judgments, or artifacts.

---

## 2. V2 Contracts (New)

### Entity Contracts

7. **Canonical entities are the authoritative identity.** All entity references across the system use canonical entity IDs from `entity_registry`. Never reference raw extracted mentions as identities.

8. **Entity aliases are append-only and never deleted.** Aliases may be deactivated (`is_active = false`) but never removed from the table. This preserves audit trail.

9. **Every entity resolution decision is logged.** Whether auto-merged, human-confirmed, or rejected — the decision, confidence, and reasoning are recorded in `entity_resolution_log`. No silent resolutions.

10. **Entity merges are reversible.** The system must support splitting wrongly merged entities. Merge history is preserved in `entity_merge_history`.

### Knowledge Graph Contracts

11. **PostgreSQL is the source of truth. Neo4j is a derived view.** If PostgreSQL and Neo4j disagree, PostgreSQL wins. Neo4j can be fully rebuilt from PostgreSQL at any time.

12. **Neo4j writes follow PostgreSQL writes.** Never write to Neo4j without first writing to PostgreSQL. The sync is eventually consistent (target: <30 seconds).

13. **Nightly consistency checks are mandatory.** A scheduled job verifies PostgreSQL ↔ Neo4j counts and reports discrepancies.

### Provenance Contracts

14. **Every insight has a provenance chain.** Any number, trend, recommendation, or claim surfaced by the Intelligence Plane must be traceable to specific signals. No orphaned insights.

15. **Confidence scores are calibrated, not arbitrary.** Confidence = (evidence strength * source diversity * resolution quality). The formula is documented and consistent.

16. **Provenance chains are immutable.** Once an insight is generated with a provenance chain, that chain is stored alongside it and never retroactively modified.

### Feedback Contracts

17. **Feedback corrections are immutable audit events.** Corrections are logged as new entries in `feedback_log`, never silently applied. The before/after state is always recorded.

18. **Human corrections take precedence over system decisions.** If a human rejects an entity merge, the system must not re-propose the same merge unless new evidence arrives.

19. **Prompt versions are tracked.** Every change to an LLM prompt is versioned in `prompt_versions` with the feedback that drove the change.

### Ingestion Contracts

20. **All sources produce the same signal format.** Regardless of source (Slack, transcript, document, web scrape), the output is a `RawSignal` with consistent structure. Source-specific data goes in `metadata`.

21. **Source identity is preserved.** Every signal retains its `source`, `source_id`, and `source_url` so it can be traced back to the original system.

22. **Deduplication is two-tier.** Within the same source: deduplicate by `content_hash` (exact match on normalized content + source + source_id). Across sources: deduplicate by embedding similarity > 0.95 (semantic dedup). Same-source dedup is checked at ingestion; cross-source dedup runs during extraction.

### Operational Contracts

23. **All timestamps are stored in UTC.** Ingestion adapters convert source-local timestamps to UTC. Original timezone preserved in `metadata.original_timezone`. All queries operate on UTC.

24. **Ingestion can proceed without entity resolution.** If the entity resolution service is unavailable, signals are stored and extraction runs. Unresolved entity mentions are queued for later resolution. The pipeline never blocks on a non-critical dependency.

25. **Entity deletion is soft, never hard.** Entities are deactivated (`is_active = false`), never deleted from the database. Signals that reference deactivated entities retain their references. This preserves provenance chains.

26. **Schema migrations are backward compatible.** PostgreSQL and Neo4j schema changes must be additive (new columns/properties with defaults). Destructive changes require a documented migration plan with rollback procedure.

27. **Dead letter queue items are never silently discarded.** Failed signals are retained in the DLQ until explicitly resolved (retried successfully or marked as abandoned by a human). The system alerts when DLQ size exceeds 50 items.

28. **Cached data is always stale-safe.** All cached query results include a `cached_at` timestamp. Consumers decide whether to accept stale data or request fresh. Cache invalidation is aggressive: any data mutation invalidates relevant cache keys.

29. **Pipeline operations are idempotent.** Re-running any pipeline stage on the same signal produces the same result (or a better result if entity resolution has improved). Re-ingestion of the same source content is a no-op (content_hash dedup).

---

## 3. Interface Contracts

### 3.1 Signal Interface

```typescript
// IMMUTABLE after creation
interface Signal {
  id: string;                    // UUID, system-generated
  source: SignalSource;          // 'slack', 'meeting_transcript', 'document', etc.
  source_id: string;             // ID in original system
  source_url?: string;           // Deep link to original
  content: string;               // Raw text content (never modified)
  content_type: ContentType;     // 'message', 'transcript_segment', 'document_chunk', etc.
  author?: string;
  timestamp: Date;               // Original content timestamp
  channel?: string;
  metadata: Record<string, any>; // Source-specific data (immutable after creation)
  created_at: Date;              // Ingestion timestamp
}
```

### 3.2 Canonical Entity Interface

```typescript
interface CanonicalEntity {
  id: string;                    // UUID
  entity_type: EntityType;       // 'customer', 'feature', 'issue', 'theme', 'stakeholder'
  canonical_name: string;        // The authoritative name
  description?: string;
  metadata: Record<string, any>;
  confidence: number;            // 0-1
  created_by: 'system' | 'human';
  last_validated_by?: 'system' | 'human';
  is_active: boolean;
}

type EntityType = 'customer' | 'feature' | 'issue' | 'theme' | 'stakeholder';
```

### 3.3 Entity Alias Interface

```typescript
interface EntityAlias {
  id: string;
  canonical_entity_id: string;
  alias: string;
  alias_normalized: string;      // Lowercased, cleaned
  alias_source: 'extracted' | 'human_confirmed' | 'llm_inferred' | 'manual';
  confidence: number;
  confirmed_by_human: boolean;
  is_active: boolean;            // Can be deactivated, never deleted
}
```

### 3.4 Feedback Item Interface

```typescript
interface FeedbackItem {
  id: string;
  feedback_type: FeedbackType;
  status: 'pending' | 'accepted' | 'rejected' | 'deferred';
  system_output: Record<string, any>;     // What the system produced
  human_correction?: Record<string, any>; // What the human says is correct
  system_confidence: number;
  resolved_by?: string;
  resolved_at?: Date;
  resolution_notes?: string;
  signals_affected: number;
  entities_affected: number;
  created_at: Date;
}
```

### 3.5 Provenance Chain Interface

```typescript
interface ProvenanceChain {
  insight_id: string;
  insight_type: string;                   // 'heatmap', 'trend', 'customer_count', etc.
  claim: string;                          // "47 customers affected by auth timeout"
  confidence: number;
  methodology: string;                    // How the number was computed
  evidence: ProvenanceLink[];
}

interface ProvenanceLink {
  signal_id: string;
  source: string;
  source_url?: string;
  content_preview: string;                // First 200 chars
  entity_mentions: string[];              // Which entities were found in this signal
  resolution_confidence: number;          // How confident was entity resolution
  timestamp: Date;
}
```

---

## 4. Data Flow Invariants

### 4.1 The Happy Path

```
Source → Signal (immutable) → Extraction → Entity Resolution → Knowledge Graph → Intelligence → MCP Response
                                                 ↑
                                          Human Feedback
                                           (improves over time)
```

### 4.2 What Must Never Happen

| Violation | Why It's Dangerous |
|-----------|-------------------|
| Modifying a signal's content after storage | Destroys audit trail; breaks provenance |
| Storing LLM-generated insight as a signal | Contaminates raw data with derived data |
| Auto-merging entities without logging | Can't debug wrong merges; can't measure accuracy |
| Writing to Neo4j without PostgreSQL write | Sync divergence; data loss if Neo4j crashes |
| Generating insight without provenance | PM can't verify; trust erodes |
| Silently applying feedback corrections | Can't audit; can't measure improvement |
| Deleting entity aliases | Breaks resolution for signals that matched on deleted alias |
| Re-proposing rejected entity merge without new evidence | Annoying; undermines human authority |
| Auto-executing New PM feedback without confirmation | New PM may not yet understand entity vocabulary; risks bad merges |
| Generating shareable reports without freshness indicator | Stakeholders may act on stale data without knowing it |
| Generating artifacts without provenance section | Stakeholders receive unverifiable claims; trust erodes across org |
| Agent directly executing entity merge/split/delete | Autonomous agents lack human judgment; bad merges could cascade |
| Agent writing without idempotency key | Agents retry on failure; duplicates corrupt signal/entity counts |
| Agent accessing events without registration | Unregistered agents are invisible in audit trail; can't be rate limited |
| Event bus dropping events silently | Agents miss critical signals; system appears unreliable |

### 4.3 Persona-Specific Data Contracts

| # | Contract | Applies To |
|---|---------|-----------|
| P-1 | All feedback_log entries MUST include `actor_persona` field | Feedback Service |
| P-2 | New PM feedback with authority='low' MUST NOT auto-execute entity merges/splits below 0.88 confidence | Feedback Service |
| P-3 | PM Leader strategic groupings create GROUPS_INTO relationships, NOT entity merges | Knowledge Graph Service |
| P-4 | Shareable reports MUST include data freshness timestamp and source methodology | Report Generation Service |
| P-5 | Generated artifacts MUST include a provenance section citing signal counts and source types | Artifact Service |
| P-6 | MCP tool responses MUST include `metadata.result_count` and `metadata.total_count` for progressive disclosure | All MCP Tools |
| P-7 | `browse_knowledge_graph` responses MUST paginate (max 25 entities per call) to prevent overwhelming New PMs | Onboarding Tools |

### 4.4 Agent-Specific Data Contracts

| # | Contract | Applies To |
|---|---------|-----------|
| AG-1 | All Agent Gateway requests MUST include a valid API key in the Authorization header | Agent Gateway |
| AG-2 | All agent write operations MUST include an `idempotency_key` header. The system MUST reject duplicate writes within a 24-hour window | Agent Gateway write endpoints |
| AG-3 | Autonomous agents MUST NOT directly execute entity merges, splits, or deletions. They can only create `feedback_log` entries with `actor_persona='autonomous_agent'` for human review | Agent Gateway, Feedback Service |
| AG-4 | All agent actions MUST be logged in both `audit_log` (with `actor='agent:{agent_name}'`) and `agent_activity_log` | Agent Gateway |
| AG-5 | Agent event subscriptions MUST specify the event types they subscribe to at registration. Agents MUST NOT receive events they didn't subscribe to | Event Bus Service |
| AG-6 | Event delivery is at-least-once. Agent consumers MUST be idempotent — receiving the same event twice must not cause duplicate side effects | All agent subscribers |
| AG-7 | Agent-ingested signals MUST go through the same normalization, deduplication, and extraction pipeline as human-ingested signals. No shortcutting the pipeline | Agent Gateway ingestion, Ingestion Plane |
| AG-8 | Per-agent rate limiting MUST be enforced. Default: 60 requests/minute. Configurable per agent in `agent_registry` | Agent Gateway |
| AG-9 | Agent-proposed entity changes (via `feedback_log`) MUST be tagged with `source_persona='agent'` and `authority='low'` so they are never auto-executed | Feedback Service |
| AG-10 | The Event Bus MUST enforce backpressure: max 100 events/second per stream. If rate exceeded, events are queued, not dropped | Event Bus Service |
| AG-11 | Agent outputs that affect PM-visible data (urgency classification, report content, competitor extraction) MUST be stored with `source_agent_id` and `agent_output_type` for PM review via `review_agent_outputs` MCP tool | All autonomous agents producing PM-visible outputs |
| AG-12 | Per-agent accuracy MUST be tracked via `agent_accuracy_30d` view. If accuracy drops below per-agent SLO for 7 consecutive days, agent MUST be automatically paused (circuit breaker) and PM alerted | Agent Gateway, Feedback Service |
| AG-13 | Every agent deployment MUST include a `version` field in `agent_registry`. Previous versions MUST be retained in `agent_version_history` for rollback | Agent Registry |
| AG-14 | Agent LLM API calls MUST include the `agent_id` in request metadata. Token usage MUST be logged in `agent_activity_log.tokens_used` for cost tracking | All LLM-calling agents |
| AG-15 | Agent cost MUST NOT exceed `max_monthly_cost_usd` configured per agent in `agent_registry`. If exceeded, agent MUST be paused until next billing cycle or manually overridden | Agent Gateway, Cost Tracking |
| AG-16 | A2A Agent Card MUST be regenerated whenever agent skills or capabilities change. The Agent Card MUST reflect the current system capabilities at all times | A2A Server |

---

## 5. Comprehensive Input/Output Validation Rules

Every input surface and output surface of the system MUST enforce the validation rules below. These are **non-negotiable** — a missing validation is a bug, not a future enhancement.

### 5.1 File Upload Validations

Applies to: `document_adapter`, `transcript_adapter`, manual uploads via MCP tools (`ingest_document`, `ingest_transcript`), and agent ingestion.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| FV-1 | Max file size: 50MB per file (configurable via `MAX_FILE_SIZE_MB`) | Reject with 413 + "File exceeds maximum size of 50MB" | Hard |
| FV-2 | Allowed file extensions: `pdf, docx, pptx, xlsx, csv, txt, vtt, srt` | Reject with 415 + "Unsupported file type: {ext}. Allowed: ..." | Hard |
| FV-3 | MIME type MUST match file extension (magic bytes validation). A `.pdf` with `application/x-msdownload` bytes is rejected | Reject with 415 + "File content does not match declared type" | Hard |
| FV-4 | No executable content: reject files with embedded macros (VBA in docx/xlsx/pptx), embedded scripts, or `.exe`/`.bat`/`.sh` within archives | Reject with 400 + "File contains executable content" | Hard |
| FV-5 | Max pages per document: 500 pages (PDF), 200 slides (PPTX), 100,000 rows (XLSX) | Truncate with warning: "Document truncated to first {limit}. Full document too large for processing." | Soft (process partial) |
| FV-6 | Encrypted / password-protected files MUST be rejected (system cannot process them) | Reject with 400 + "Password-protected files are not supported. Please provide an unencrypted version." | Hard |
| FV-7 | Corrupt files (truncated, invalid headers, unreadable) MUST be detected before pipeline entry | Reject with 400 + "File appears corrupted and cannot be parsed" | Hard |
| FV-8 | Empty files (0 bytes or no extractable text content) MUST be rejected | Reject with 400 + "File contains no extractable text content" | Hard |
| FV-9 | Max files per upload batch: 20 files | Reject batch with 400 + "Max 20 files per upload. Please split into multiple uploads." | Hard |
| FV-10 | Total upload size per batch: 200MB | Reject batch with 413 + "Total batch size exceeds 200MB" | Hard |
| FV-11 | Uploaded files stored with UUID filenames in `data/uploads/` (prevent path traversal) | N/A (architectural) | Hard |
| FV-12 | Uploaded files MUST be deleted after processing (configurable retention: default 24 hours) | N/A (operational) | Hard |

### 5.2 Text Input Validations

Applies to: transcript paste, search queries, entity names, feedback text, webhook payloads, and all free-text MCP tool parameters.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| TV-1 | All text input MUST be valid UTF-8. Non-UTF-8 bytes MUST be rejected or transcoded with replacement characters logged | Reject with 400 + "Input contains invalid UTF-8 encoding" | Hard |
| TV-2 | Null bytes (`\x00`) MUST be stripped from all text inputs before processing | Strip silently + log warning | Soft |
| TV-3 | Control characters (except `\n`, `\r`, `\t`) MUST be stripped from text inputs | Strip silently | Soft |
| TV-4 | Signal content: min 20 chars, max 100,000 chars (after trimming) | Hard reject at both bounds | Hard |
| TV-5 | Search query parameters: max 1,000 chars | Truncate with warning | Soft |
| TV-6 | Entity names: min 2 chars, max 500 chars. Must contain at least one alphanumeric character | Reject with 400 + specific error | Hard |
| TV-7 | Entity descriptions: max 2,000 chars | Truncate with warning | Soft |
| TV-8 | Feedback correction text: max 5,000 chars | Truncate with warning | Soft |
| TV-9 | Feedback resolution notes: max 2,000 chars | Truncate with warning | Soft |
| TV-10 | Webhook URLs and A2A Agent Card URLs: MUST be valid HTTPS URLs. No `localhost`, no private IPs (`10.*`, `172.16-31.*`, `192.168.*`, `127.*`), no `file://` scheme | Reject with 400 + "URL must be a valid HTTPS URL with a public domain" | Hard |
| TV-11 | Transcript text paste: max 500,000 chars (transcripts can be long) | Reject with 413 + "Transcript exceeds maximum length. Please split into sections." | Hard |
| TV-12 | JSON request body max size: 10MB (all API endpoints) | Reject with 413 | Hard |
| TV-13 | JSON nesting depth: max 20 levels (prevent DoS via deeply nested JSON) | Reject with 400 + "JSON nesting too deep" | Hard |

### 5.3 Slack Message Validations

Applies to: `slack_adapter` ingestion.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| SV-1 | Bot messages: configurable filter (`INGEST_BOT_MESSAGES=false` by default). When false, skip bot messages silently | Skip, no error | Soft |
| SV-2 | Emoji-only / reaction-only messages: skip (no text content to extract) | Skip, no error | Soft |
| SV-3 | Thread depth: ingest up to 50 replies per thread. Beyond 50, summarize thread context | Truncate with metadata: `thread_truncated: true` | Soft |
| SV-4 | Slack file attachments: only process supported types (FV-2 list). Skip unsupported attachments with log | Skip attachment, process message text | Soft |
| SV-5 | Slack message max length: 40,000 chars (Slack's own limit). Validate anyway | Should never fail (Slack enforces), but log if exceeded | Soft |
| SV-6 | Duplicate Slack messages: check `slack_message_ts` + `channel_id` for idempotency | Skip duplicate, no error | Soft |

### 5.4 Web Scrape Content Validations

Applies to: `crawler_bot_adapter`.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| WV-1 | HTML content MUST be sanitized: strip `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>` tags and all event handlers (`onclick`, `onload`, etc.) | Sanitize before storage | Hard |
| WV-2 | Max content length per web scrape signal: 200,000 chars (web pages can be large) | Truncate with `content_truncated: true` metadata | Soft |
| WV-3 | Source URL MUST be a valid HTTP/HTTPS URL. No `javascript:`, `data:`, or `file:` schemes | Reject with 400 | Hard |
| WV-4 | Duplicate URL detection: same URL within 24 hours treated as duplicate unless `force_refresh=true` | Skip with dedup log entry | Soft |
| WV-5 | Content encoding: MUST be converted to UTF-8. Detect source encoding from HTTP headers or meta tags | Transcode, log original encoding | Soft |

### 5.5 MCP Tool Parameter Validations

Applies to: all 35 MCP tools. These are **additional** constraints beyond the `inputSchema` Zod schemas.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| MV-1 | Date range parameters: max span of 365 days. Requests for "all signals since 1970" MUST be rejected | Reject with "Date range too wide. Maximum: 365 days." | Hard |
| MV-2 | Date parameters MUST NOT be in the future (tolerance: +1 hour for timezone edge cases) | Reject with "End date cannot be in the future" | Hard |
| MV-3 | Limit/count parameters: min 1, max 500 per request. Default varies by tool (typically 25-100) | Clamp to [1, 500] with warning if adjusted | Soft |
| MV-4 | String parameters: max 1,000 chars unless explicitly documented otherwise | Truncate with warning | Soft |
| MV-5 | Array parameters (e.g., entity_ids, signal_ids): max 100 items per request | Reject with "Too many items. Maximum: 100 per request." | Hard |
| MV-6 | UUID parameters MUST be valid UUID v4 format | Reject with "Invalid ID format" | Hard |
| MV-7 | Enum parameters validated against allowed values (Zod handles this, but double-check at service layer) | Reject with "Invalid value for {param}. Allowed: [...]" | Hard |
| MV-8 | Graph traversal depth (`max_hops`): 1-4, default 2. Values >4 rejected | Clamp to [1, 4] | Hard |

### 5.6 Agent Gateway / A2A Input Validations

Applies to: Agent Gateway REST API and A2A Server.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| AV-1 | Request body max size: 10MB (consistent with TV-12) | Reject with 413 | Hard |
| AV-2 | A2A messages: max 10 parts per message | Reject with A2A error response | Hard |
| AV-3 | A2A FileParts: max 50MB per file, allowed MIME types same as FV-2 | Reject with A2A error response | Hard |
| AV-4 | A2A DataParts: max 1MB JSON payload per part | Reject with A2A error response | Hard |
| AV-5 | Idempotency-Key header: required for all write endpoints. Must be UUID v4. Checked against 24-hour dedup window | Reject with 400 + "Missing or invalid Idempotency-Key header" | Hard |
| AV-6 | Content-Type header: MUST be `application/json` for REST, `application/json` for A2A JSON-RPC | Reject with 415 | Hard |
| AV-7 | API key format: MUST be a non-empty string in the correct header (`X-API-Key` for A2A, `Authorization: Bearer` for REST) | Reject with 401 | Hard |

### 5.7 Entity / Alias Validations

Applies to: entity creation, entity renaming, alias management, agent proposals.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| EV-1 | Entity name: min 2 chars, max 500 chars, must contain at least one letter | Reject with specific error | Hard |
| EV-2 | Entity name normalization: collapse multiple spaces to single space, trim leading/trailing whitespace | Normalize silently | Auto |
| EV-3 | Alias uniqueness: an alias MUST NOT point to two different active canonical entities. If conflict detected, route to human review | Route to feedback_log as `alias_conflict` | Hard |
| EV-4 | Max aliases per entity: 50 (prevent alias explosion from automated processes) | Reject with "Entity has reached maximum alias count. Review existing aliases." | Hard |
| EV-5 | Entity type MUST be one of: `customer`, `feature`, `issue`, `theme`, `stakeholder` | Reject with "Invalid entity type" | Hard |
| EV-6 | Entity description: max 2,000 chars (TV-7). MUST NOT contain raw HTML, Markdown links, or executable content | Sanitize + store | Soft |
| EV-7 | Reject entity names that are common English stop words ("the", "and", "it", "this") or single characters | Reject with "Entity name too generic" | Hard |
| EV-8 | Reject entity names that are substrings of Cypher injection patterns (`MATCH`, `DELETE`, `MERGE` followed by `(`) | Reject + log for security review | Hard |

### 5.8 Feedback Submission Validations

Applies to: `feedback_service`, MCP feedback tools, agent proposals.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| FBV-1 | Feedback type: MUST be in allowed list (see 07_FEEDBACK_LOOPS.md §2) | Reject with 400 | Hard |
| FBV-2 | Status: MUST be one of `pending`, `accepted`, `rejected`, `deferred` | Reject with 400 | Hard |
| FBV-3 | system_output JSONB: MUST NOT be empty or null | Reject with 400 + "Feedback must reference a system output" | Hard |
| FBV-4 | human_correction JSONB: required when resolving. Max 10KB | Reject if too large | Hard |
| FBV-5 | Max feedback submissions per hour per actor: 100 (prevent spam from runaway agent or script) | Reject with 429 + "Feedback rate limit exceeded" | Hard |
| FBV-6 | Re-proposing a rejected merge: MUST include `new_evidence` field explaining why this time is different. Without new evidence, system rejects with "This merge was previously rejected. Provide new evidence." | Reject with 400 | Hard |
| FBV-7 | system_confidence: MUST be float in range [0.0, 1.0] | Reject with 400 | Hard |

---

## 6. Output Validation Rules

Every output surface MUST enforce these rules before data leaves the system.

### 6.1 LLM Extraction Output Validations

Applies to: `llm_extraction_service`, `relationship_extraction_service`, `graphrag_indexer_service`.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| LV-1 | Extraction output MUST validate against `ExtractionOutputSchema` (Zod). Unexpected fields rejected | Retry with reprompt (1x), then DLQ | Hard |
| LV-2 | Max entities per type per signal: 20 (customers, features, issues), 10 (themes) | Truncate to limit, log warning | Hard |
| LV-3 | Max relationships per signal: 50 | Truncate, log warning | Hard |
| LV-4 | Hallucination guard: every extracted entity name MUST appear in original signal content (substring or >0.85 fuzzy match). Ungrounded entities flagged `possible_hallucination`, confidence -50% | Flag + reduce confidence | Soft |
| LV-5 | Confidence scores: MUST be in [0.0, 1.0]. Values outside range clamped and logged | Clamp + log | Soft |
| LV-6 | LLM response timeout: 60 seconds per extraction call. Beyond this, mark as `extraction_timeout` in DLQ | DLQ with timeout reason | Hard |
| LV-7 | LLM returned non-JSON or unparseable response: retry once with explicit "respond only with valid JSON" instruction | Retry (1x), then DLQ | Hard |
| LV-8 | Sentiment value MUST be one of: `positive`, `negative`, `neutral`, `mixed` | Default to `neutral` if invalid, log warning | Soft |
| LV-9 | Entity type in extraction MUST match allowed types (EV-5). Invalid types re-classified with focused prompt | Re-classify (1x), then default to `theme` | Soft |

### 6.2 Generated Report / Artifact Output Validations

Applies to: `report_generation_service`, `generate_artifact` MCP tool, `generate_shareable_report`.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| RV-1 | Max report length: 50,000 chars (Markdown). Reports approaching limit should summarize rather than truncate | Summarize final sections if approaching limit | Soft |
| RV-2 | Every report/artifact MUST include: data freshness timestamp, source methodology, provenance section | Reject generation if provenance is incomplete | Hard |
| RV-3 | PII detection: scan generated content for patterns matching email addresses, phone numbers, SSNs. If detected, redact with `[REDACTED]` and log | Redact + log | Hard |
| RV-4 | Shareable reports (stakeholder-facing) MUST NOT contain internal entity IDs, raw signal IDs, or system-internal terminology | Post-process: replace IDs with human-readable names | Hard |
| RV-5 | Generated Markdown MUST be valid (no unclosed code blocks, no broken links). Validate with a basic Markdown parser | Fix common issues (close code blocks, remove broken links) | Soft |
| RV-6 | Generated reports MUST include a "generated by PM Intelligence System" footer with timestamp | Auto-append if missing | Soft |
| RV-7 | Artifact content MUST NOT contain LLM self-references ("As an AI language model...", "I cannot..."). Strip such phrases | Strip + log | Soft |

### 6.3 Slack Alert Bot Output Validations

Applies to: `slack_alert_bot` agent.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| SAV-1 | Slack message character limit: 4,000 chars per block, 50 blocks per message. If content exceeds, split into multiple messages or summarize | Summarize to fit | Hard |
| SAV-2 | Alert deduplication: do NOT send the same alert (same entity + same event type) twice within 1 hour | Skip duplicate, log | Hard |
| SAV-3 | Alert throttling: max 20 alerts per channel per hour. Beyond this, batch remaining alerts into a single summary message | Batch into summary | Hard |
| SAV-4 | Alert content MUST NOT contain raw signal text, internal IDs, or stack traces. Use summarized, PM-friendly language | Post-process before sending | Hard |
| SAV-5 | Alert priority formatting: P0 = 🔴, P1 = 🟡, P2 = 🔵 (consistent visual hierarchy) | N/A (formatting rule) | Soft |

### 6.4 JIRA Ticket Output Validations

Applies to: `jira_sync_agent`.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| JV-1 | JIRA summary field: max 255 chars. Truncate with "..." if longer | Truncate | Hard |
| JV-2 | JIRA description field: max 32,767 chars. Summarize if content exceeds | Summarize to fit | Hard |
| JV-3 | JIRA project key: MUST be validated against configured allowed project keys before API call | Reject with "Invalid JIRA project key" | Hard |
| JV-4 | Duplicate ticket detection: before creating, search JIRA for existing tickets matching the same entity + issue combination within 30 days | Prompt PM for confirmation: "Similar JIRA ticket exists: {key}. Create anyway?" | Soft |
| JV-5 | Required JIRA fields (summary, description, project, issuetype) MUST all be populated before API call | Reject with "Missing required JIRA fields: {fields}" | Hard |
| JV-6 | JIRA API response validation: verify ticket was actually created (check response for `key` field) | Retry (1x), then DLQ with `jira_creation_failed` | Hard |

### 6.5 Knowledge Graph Write Validations

Applies to: `knowledge_graph_service`, Neo4j sync operations.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| KV-1 | Max nodes per write batch: 100 | Split into multiple batches | Soft |
| KV-2 | Max relationships per write batch: 500 | Split into multiple batches | Soft |
| KV-3 | Node property value max size: 10,000 chars per property | Truncate with warning | Soft |
| KV-4 | Self-referencing relationships prohibited: entity MUST NOT have a relationship to itself (except `GROUPS_INTO`) | Reject relationship silently | Hard |
| KV-5 | Orphan node detection: new nodes MUST have at least one relationship within 24 hours, or be flagged for review | Flag for Data Quality Agent review | Soft |
| KV-6 | Neo4j label: MUST be in allowlist (`Customer`, `Feature`, `Issue`, `Theme`, `Stakeholder`, `Signal`, `Opportunity`) | Reject with error | Hard |
| KV-7 | Relationship types: MUST be in allowlist (`MENTIONS`, `AFFECTS`, `RELATES_TO`, `USES`, `HAS_ISSUE`, `GROUPS_INTO`, etc.) | Reject with error | Hard |

### 6.6 Event Bus Output Validations

Applies to: `event_bus_service`.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| EBV-1 | Event payload max size: 64KB per event. Larger payloads MUST use reference IDs, not inline data | Reject event publication with error | Hard |
| EBV-2 | Event TTL: events expire from Redis Streams after 7 days | Auto-trimmed by Redis | Auto |
| EBV-3 | Event type MUST be in registered event catalog (see 16_AGENTIC_INTERACTIONS.md §5.1) | Reject with "Unknown event type" | Hard |
| EBV-4 | Event ordering: events within a single stream are ordered. Cross-stream ordering is NOT guaranteed. Consumers MUST NOT depend on cross-stream ordering | N/A (design constraint) | Design |
| EBV-5 | Event payload schema validation: every event validated against `SystemEvent` Zod schema before publication | Reject malformed events | Hard |
| EBV-6 | Events MUST NOT contain raw signal content (privacy). Use signal_id references instead | Reject + log | Hard |

### 6.7 Stakeholder Access Agent Output Validations

Applies to: `stakeholder_access_agent`.

| # | Rule | Action on Failure | Severity |
|---|------|-------------------|----------|
| STAV-1 | Responses MUST NOT expose: raw signal content, internal entity IDs (UUID), system-internal field names, or PM-only data | Post-process: replace with human-readable equivalents | Hard |
| STAV-2 | Responses MUST NOT expose: individual contact details, email addresses, or phone numbers | Redact PII | Hard |
| STAV-3 | Aggregation minimum: queries returning customer-specific data MUST aggregate across at least 3 signals (prevent identification from single-signal data) | If fewer than 3 signals, return "Insufficient data for this query" | Hard |
| STAV-4 | Response max size: 10,000 chars. Stakeholder responses MUST be concise | Summarize to fit | Soft |
| STAV-5 | Every response MUST include data freshness timestamp | Auto-append if missing | Hard |
| STAV-6 | Every response MUST include: "For more detail, contact your Product Manager." | Auto-append if missing | Soft |

---

## 7. Validation Implementation Checklist

Every service MUST implement validations at the appropriate layer:

```
Input Validation Layers:

  Layer 1: Transport (Express middleware)
    - Request body size limit (TV-12: 10MB)
    - Content-Type validation (AV-6)
    - JSON parsing with depth limit (TV-13: 20 levels)
    - Rate limiting (per session, per agent)
    - Authentication (API key, A2A)

  Layer 2: API Route Handler
    - Parameter schema validation (Zod inputSchema)
    - UUID format validation (MV-6)
    - Enum validation (MV-7)
    - Date range validation (MV-1, MV-2)
    - Array size limits (MV-5)

  Layer 3: Service Layer
    - Business rule validation (entity uniqueness, alias conflicts, feedback rules)
    - Content sanitization (control chars, HTML, injection patterns)
    - Encoding validation (UTF-8)
    - File type + MIME validation (magic bytes)
    - Duplicate detection

  Layer 4: Storage Layer
    - Database constraints (CHECK, UNIQUE, NOT NULL, FK)
    - Neo4j label/relationship allowlist
    - Write batch size limits

Output Validation Layers:

  Layer 1: Service Layer (before return)
    - LLM output schema validation
    - Hallucination guard
    - Confidence score bounds
    - Content length limits
    - PII detection and redaction

  Layer 2: API Response Handler
    - Response size limits
    - Stakeholder data scoping
    - Internal ID stripping
    - Freshness timestamp injection

  Layer 3: External System Integration (before outbound call)
    - Slack message length + formatting
    - JIRA field constraints
    - Webhook URL safety validation
    - Event payload size + schema
```
