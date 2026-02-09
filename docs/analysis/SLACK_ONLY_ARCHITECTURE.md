# Slack-Only Architecture (Cursor-LLM Only)

This document defines a Slack-only implementation that improves PM judgment quality by
turning raw Slack signals into structured, queryable facts with citations. It keeps
the 4-layer conceptual framing while narrowing scope to Slack ingestion and Slack-driven
opportunity detection.

## Goals

- Produce actionable, evidence-backed insights from Slack conversations.
- Support precise questions (e.g., "Which customers use Feature X? How much?").
- Use Cursor-provided LLMs only, and only for extraction/summarization steps.
- Preserve raw signals as immutable source-of-truth.

## Non-Goals (Slack-Only Scope)

- No non-Slack sources (Grafana, JIRA, Confluence, Discord, forums) in this phase.
- No automatic product prioritization or roadmap generation.
- No autonomous decisions.

## Architecture Overview

Flow: `signals -> opportunities -> judgments -> artifacts`

Slack-only additions focus on:

- Higher-quality extraction from Slack threads
- Canonical feature dictionary and customer mapping
- Hybrid retrieval (structured + semantic) for reliable queries

## Data Model (Slack-Only)

### Raw Signals (immutable)

- `signals`
  - `id`, `source` (slack), `channel_id`, `thread_ts`, `message_ts`
  - `user_id`, `text`, `is_thread_reply`, `is_edit`, `is_delete`
  - `raw_payload` (JSON)

### Structured Entities (derived)

- `customers`
  - `id`, `name`, `segment`, `crm_id`
- `slack_users`
  - `slack_user_id`, `customer_id`, `display_name`
- `features`
  - `id`, `canonical_name`, `aliases` (JSON array)
- `issues`
  - `id`, `title`, `category`, `severity`, `first_seen_at`

### Relations / Facts

- `signal_entities`
  - `signal_id`, `entity_type`, `entity_id`, `confidence`
- `customer_feature_usage`
  - `customer_id`, `feature_id`, `usage_strength`, `last_mentioned_at`
- `customer_issue_reports`
  - `customer_id`, `issue_id`, `evidence_signal_id`

### Opportunity Cluster (derived)

- `opportunities`
  - `id`, `title`, `summary`, `score`, `created_at`
- `opportunity_signals`
  - `opportunity_id`, `signal_id`

### Embeddings (semantic retrieval)

- `signal_embeddings`
  - `signal_id`, `embedding`
- `issue_embeddings`
  - `issue_id`, `embedding`

## Processing Pipeline

### 1) Ingestion

- Pull history + webhooks for new messages.
- Include thread replies and edits/deletes.
- Store raw messages as immutable `signals` with `raw_payload`.

### 2) Normalization

- Normalize timestamps, user ids, channel ids.
- Tag thread structure (root vs reply).
- Apply basic filters (bot messages, system events).

### 3) Extraction (Cursor LLM)

LLM tasks:

- Entity extraction (customers, features, issues).
- Relation extraction (customer uses feature, reports issue).
- Summaries for opportunity clusters only, with citations.

Non-LLM tasks:

- Rule-based feature alias mapping.
- Identity resolution (Slack user -> customer).

### 4) Storage

Recommended:

- Postgres for structured tables.
- pgvector for embeddings.

### 5) Query & Retrieval

Use hybrid retrieval:

- Structured filters (customer, feature, time range).
- Vector search for semantic matches.
- Final LLM step to synthesize answers with citations.

## Query Patterns

### Q1: "Which customers use Feature X?"

1) Resolve Feature X via feature dictionary + aliases.
2) Query `customer_feature_usage` with recent signals.
3) Return ranked list with evidence links to `signals`.

### Q2: "How much are they using it?"

Because Slack is not instrumentation:

- Use "usage_strength" as a qualitative scale derived from frequency and
  recency of mentions across threads.
- Optionally mark as "self-reported usage" vs "issue report".

### Q3: "What bottlenecks do they face?"

1) Query `customer_issue_reports` linked to feature.
2) Cluster issue themes (embedding + rules).
3) Return bottlenecks with cited messages.

## Feature Dictionary Strategy

- Start with a manually curated list of core features.
- Maintain aliases and common paraphrases.
- Update aliases from user feedback and extraction misses.

## Identity Resolution Strategy

Slack user -> customer mapping is required to answer "which customers":

- Manual mapping table initially.
- Optional enrichment with CRM exports later.
- Confidence flags for ambiguous matches.

## Quality Controls

- Require citations for each insight.
- Confidence threshold for extracted relations.
- Human review for high-impact opportunities.
- Recency decay to avoid stale insights.

## Failure Modes and Mitigations

### Noisy or off-topic chatter

- Mitigation: classifier filter + channel allowlist.

### Missing customer identity

- Mitigation: mark as "unknown customer"; exclude from customer-level queries.

### Feature ambiguity

- Mitigation: require feature dictionary match; log unknown mentions.

### LLM hallucination

- Mitigation: "no evidence, no claim" rule; citations mandatory.

### Duplicate signals

- Mitigation: hash and thread-aware deduping.

## MVP Success Criteria

- At least 80% of feature mentions mapped to dictionary.
- Customer-level queries return evidence-backed answers.
- Opportunity summaries include citations for each key claim.
