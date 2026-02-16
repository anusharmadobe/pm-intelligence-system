# PM Intelligence V2 — UI Plan
> **Last Updated:** 2026-02-09

## Goals
- Provide a single, persona-based UI on top of the Agent Gateway.
- Make the system usable without needing tool names or API details.
- Surface insights, provenance, and actions with minimal clicks.

## Personas and UI Surfaces

### 1) PM Daily Driver
- **Primary needs:** Triage signals, understand customer impact, draft weekly updates.
- **UI surfaces:** Dashboard, Signals search, Customer profiles, Heatmaps, Trends, Reports.
- **Already built:** Search, customer profile, heatmap, trends, report generation.
- **Next:** Saved views, personal follow-ups, export to Jira/Docs, notification subscriptions.

### 2) PM Leader
- **Primary needs:** Portfolio-level health, executive summaries, risk monitoring.
- **UI surfaces:** Leader dashboard, Roadmap priorities, KPI trend panels, rollups by product area.
- **Already built:** Heatmap + trends + report generation (executive summary).
- **Next:** Multi-team filters, scorecards, risk timeline, quarterly rollups.

### 3) New PM / Onboarding
- **Primary needs:** Learn product area, context discovery, top customers and issues.
- **UI surfaces:** Guided walkthrough, "Top 10" entity lists, provenance drilldowns.
- **Already built:** Entity search + provenance lookup.
- **Next:** Guided tours, curated starter dashboards, glossary + FAQs inline.

### 4) Stakeholder / Exec / GTM
- **Primary needs:** Quick answers, customer impact, high-level insights.
- **UI surfaces:** Stakeholder summary tab, read-only reports, quick search.
- **Already built:** Reports + customer profile + heatmaps.
- **Next:** Shareable report links, scheduled briefs, export to slides.

### 5) Admin & Agent Manager
- **Primary needs:** Operability, health checks, agent registration, event monitoring.
- **UI surfaces:** System health panel, agent registry, event stream, audit views.
- **Already built:** Agent registration, system health, events history.
- **Next:** API key rotation UI, webhook subscription manager, DLQ review queue.

## Information Architecture (Current)
- **PM Dashboard**
- **PM Leader**
- **New PM**
- **Stakeholder**
- **Admin & Agents**
- **System Health**

Each tab maps to a persona workflow and calls the Agent Gateway endpoints behind the scenes.

## Current Implementation (Delivered)
- **Static Web UI** at `/ui` (HTML/CSS/JS).
- **API key entry** with localStorage storage for authenticated calls.
- **Persona tabs** with buttons to run common workflows:
  - Search signals, customer profiles, heatmaps, trends, opportunities.
  - Generate reports and view system health.
  - Register new agents and view event history.

## Next Iteration (Recommended)
- Replace static UI with a component-based front-end (React/Next.js).
- Add saved filters + query presets per persona.
- Add charts (heatmap grid, trend lines, pipeline status cards).
- Add shareable report links and scheduled report delivery.
- Add agent registry administration (rotate keys, permissions, subscriptions).

## Success Metrics
- Time-to-insight under 2 minutes for common PM questions.
- <5 clicks for top persona tasks.
- >80% of PMs use the UI weekly for health checks and trend review.
