# PM Component Mapping and Hybrid Insights

## Sources Used

- Product component mapping: `Product Component Mapping.xlsx` (Sheet1).
- Issue list: `exports/pm_insights_summary.json`.
- AEM Forms capability descriptions: https://experienceleague.adobe.com/en/docs/experience-manager-65/content/forms/getting-started/introduction-aem-forms

## Product Component Map

Components are taken directly from `Product Component Mapping.xlsx`, with descriptions to ground issue mapping.

| Component | Description | Lead |
| --- | --- | --- |
| Accessibility | AEM Forms Accessibility issues | Sunny Marwaha |
| Adaptive Forms - Authoring | — | Sunny Marwaha |
| Adaptive Forms - Core Components | Core components - Issues impacting the Github core components and themes repository | Sudhanshu Singh |
| Adaptive Forms - Runtime | — | Sudhanshu Singh |
| AFCS | Automated Forms Conversion Service | Mayank Agarwal |
| Assembler | Component for Assembler Service | Sufyan Haroon |
| BCF | Bar Coded Forms Service | Sufyan Haroon |
| Cloud based Communication Designer | Delrina Project | Ranjeet Kumar Choudhary |
| Cloud Service Platform | Component for tracking AEMaaCS Foundation aligned work | Sufyan Haroon |
| Core | Core-OSGI, Foundation issues in OSGi stack | Sunny Marwaha |
| CPDF | Convert PDF service | Sufyan Haroon |
| Designer | Desktop Designer application | Ranjeet Kumar Choudhary |
| DevOps | Internal | Sunny Marwaha |
| DRM | Component for Digital Rights Management Server and Clients | Sufyan Haroon |
| ECU | Component for Encryption, Signatures and Reader Extensions | Sufyan Haroon |
| Edge Delivery | Edge Delivery Services for Forms | Vijay Kumar Jalagari |
| Evergreen Shoots | Internal | Sunny Marwaha |
| Forms - APP | AEM Forms mobile app | Mayank Agarwal |
| Forms - ESS | — | — |
| Forms - Workflow | OSGi workflow engine | Mayank Agarwal |
| Forms Manager | Product UI where forms and documents are uploaded, created, managed | Sunny Marwaha |
| Forms-Output | Component for Forms and Output Services | Sufyan Haroon |
| Foundation JEE | Foundation layer for JEE stack | Sunny Marwaha |
| GenAI | All things GenAI in general | Mayank Agarwal |
| Headless Adaptive Forms | — | Sudhanshu Singh |
| Integration - 3rd Party | — | Mayank Agarwal |
| Integration - Captcha | — | Mayank Agarwal |
| Integration - DX | DX Integrations with Forms like Adobe Experience Platform, Marketo, AJO, Analytics, Target | Mayank Agarwal |
| Integration - FDM | Form Data Model for backend data connections | Mayank Agarwal |
| Integration - Sign | Integration with Adobe Sign | Mayank Agarwal |
| Interactive Communications | — | Sufyan Haroon |
| JEE-Security | Component for reporting security tickets in JEE | Sufyan Haroon |
| Localization | — | Rastislav Indrisek |
| Mobile Forms | Mobile Forms technology for HTML based forms which have look and feel of PDF | Sudhanshu Singh |
| PDF/XMP Utility | Component for PDF Utility and XMP Utility Services | Sufyan Haroon |
| PDFG | PDF Generator capability | Sufyan Haroon |
| Portal | Component for Forms Portal | Sunny Marwaha |
| Release 650 | Internal | Sunny Marwaha |
| Rule Editor | Adaptive Forms Rule Editor | Sunny Marwaha |
| Security | — | Sufyan Haroon |
| Transaction Reporting | — | Sunny Marwaha |

## Issue-to-Component Mapping

Mapping uses the component list above and issue summaries from `exports/pm_insights_summary.json`.

| Issue | Mapped Components | Rationale |
| --- | --- | --- |
| MasterPage option causing confusion during fragment creation | Adaptive Forms - Authoring, Rule Editor | Fragment creation and authoring UX sit in the authoring stack. |
| Lost thousands of submissions during a service outage in VIP incident | Adaptive Forms - Runtime, Forms - Workflow | Submission failures are runtime and workflow execution concerns. |
| All current forms blocked from UAT due to unresolved routing and model.json failures | Adaptive Forms - Core Components | Model.json and embedded routing issues tie to core components. |
| Embedded form failures due to model.json paths not being rewritten properly through Cloudflare and AEM filters | Adaptive Forms - Core Components, Edge Delivery | Rewriting and delivery failures align with core components and edge delivery. |
| Four forms >40 pages block generation of AF forms | AFCS, CPDF | Large conversion workloads stress conversion services. |
| Blocked creating cloud config due to missing admin access and inability to see global container | Cloud Service Platform, Security | Cloud config visibility and access control. |
| Intermittent inability to access Azure SQL database despite dedicated egress IP being whitelisted | Integration - FDM | Data source connectivity is owned by FDM integration. |
| Current forms landscape is fragmented across AEM forms, fillable PDFs, and HTML forms, causing inefficiencies | Forms Manager, Designer, Mobile Forms | Mixed form types and management fragmentation. |
| Create IC from PDF flow broken in AI Assistant | Interactive Communications, GenAI | IC creation and AI assistant flow align with IC and GenAI. |
| Customer SQL server connection is getting dropped and sometimes returning too many requests | Integration - FDM | Backend data connection instability. |
| Access to AEM forms is pending, preventing form creation despite Marketo connectors set up | Forms Manager, Integration - DX | Authoring access plus Marketo/DX integration. |
| Form framework does not scale for thousands of forms | Adaptive Forms - Authoring, Forms Manager | Authoring and management scalability. |
| Azure SQL connection succeeds from Canada Central but not from other regions | Integration - FDM, Cloud Service Platform | Region-specific connectivity and cloud platform routing. |
| Cloudflare is blocking submissions for new forms; need a permanent solution | Adaptive Forms - Runtime, Edge Delivery | Submission runtime blocked at edge. |

## Improved Data Quality Flaws

1. **Component taxonomy consistency**: validate every extracted component against the mapping doc and log to an "unknown component" bucket for triage.
2. **Customer entity resolution**: canonicalize customer names and aliases (e.g., "LPL" vs "LPL Financial") and persist a single `customer_id` across variants using CRM-backed mappings.
3. **Evidence integrity**: store Slack permalinks, thread context, and snippets for every extracted issue/request to make audit and review trivial.
4. **Signal deduplication**: use `(source_ref + thread_ts + content_hash)` to prevent duplicate signals from edits and replays.
5. **Noise handling**: downweight low-value coordination messages (meeting logistics, CC-only posts) instead of dropping them, preserving context without polluting insights.

## Improved Extraction Flaws

1. **Thread context usage**: concatenate parent + reply for extraction so short replies inherit intent and entities.
2. **Request classification**: separate internal coordination asks from customer feature requests; only the latter flow into roadmap candidates.
3. **Issue extraction coverage**: use deterministic rules for explicit issues and LLM inference for implicit issues, with confidence thresholds.
4. **Component mapping completeness**: build a component keyword/alias dictionary from the mapping doc and use it deterministically before LLM fallback.
5. **Confidence calibration**: enforce consistent scoring and decay rules, and require evidence for high-confidence outputs.

## Hybrid Approach (Recommended)

1. **Deterministic pass (fast triage)**:
   - Normalize text, map components using the mapping doc, detect known entities and explicit issues.
   - Filter or downweight low-value signals and assign preliminary quality scores.
2. **LLM pass (semantic enrichment)**:
   - Run on ambiguous/high-impact signals to extract issues, requests, themes, and relationships with evidence.
   - Resolve component ambiguity using descriptions and context.
3. **Merge and reconcile**:
   - Preserve deterministic extracts as baseline.
   - Use LLM outputs to fill gaps and resolve ambiguity without overwriting raw signals.

## PM Workflow Enhancements (Added 1-4)

1. **Impact scoring**: weight insights by customer tier/ARR and signal recency to prioritize roadmap candidates.
2. **Trend detection**: track theme and issue volume changes week-over-week to surface emerging risks or opportunities.
3. **Request → Epic mapping**: cluster similar requests and map them to roadmap epics with evidence links.
4. **Evidence export**: export structured CSV/JSON with permalinks, snippets, and component tags for PM review.

