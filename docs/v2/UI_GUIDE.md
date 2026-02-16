# PM Intelligence V2 — Web UI Guide

> **Last Updated:** 2026-02-11

## Overview

PM Intelligence ships with a lightweight Web UI served at `/ui`. It is designed to give each persona a fast, task-focused surface on top of the Agent Gateway API.

Current UI status: **MVP implemented** (tabs + forms + results). It is intentionally minimal and API-first; no stateful backend required.

## Personas and Primary Flows

### 1) Product Manager
- Search signals by customer/feature/theme
- View customer profile summaries
- Run heatmaps and trends
- Ingest ad-hoc signals (transcripts, notes)

### 2) PM Leader
- Generate weekly digests or exec summaries
- View opportunity lists and RICE-style prioritization
- Review top trends and emerging issues

### 3) New PM
- Load a customer profile by name
- Browse top issues and features for a product area
- Ask for onboarding-style summaries

### 4) Stakeholder
- Read-only queries (customer status, issue impact)
- Access scoped to limited data (future: stakeholder access policies)

### 5) Admin & Agents
- Register agents and rotate API keys
- View system health
- Poll event history

## Current UI Coverage (MVP)

The UI includes:
- API key storage + agent registration
- Tabs for each persona
- Forms wired to Agent Gateway endpoints:
  - `/signals` search
  - `/query` knowledge questions
  - `/customer/{name}` profile
  - `/heatmap`
  - `/trends`
  - `/opportunities`
  - `/entities` search
  - `/ingest`
  - `/sources`
  - `/reports/generate`
  - `/events/history`
  - `/health`

## Planned Enhancements

Short-term (V2.x):
- Saved queries and dashboards per persona
- Results export (CSV/JSON) from UI
- Inline provenance links for every metric
- Lightweight review queue UI for entity merges

Mid-term (V3):
- Role-based access & views (RBAC)
- Personalization (saved filters, subscriptions)
- Activity timeline per customer/feature

## How to Access

1. Start the API server:
   - `npm run dev`
2. Open:
   - `http://localhost:3000/ui`

The UI uses the Agent Gateway API and requires an API key for most actions.
