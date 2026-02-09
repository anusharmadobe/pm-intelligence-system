# V2 Open Source Project Evaluation

> **Version:** 2.0
> **Date:** 2026-02-09
> **Status:** Research Complete

---

## 1. Evaluation Purpose

Extensive internet research was conducted to find open-source projects that could reduce build effort for the PM Intelligence Context Layer. Each project was evaluated on: relevance, maturity, license, integration effort, and actual value.

---

## 2. Tier 1: Strongly Recommended — Adopt

### 2.1 Microsoft GraphRAG

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/microsoft/graphrag |
| **Stars** | 30,700+ |
| **License** | MIT |
| **Language** | Python |
| **Last Updated** | Active (weekly commits) |

**What it does:**
- Extracts entities, relationships, and key claims from unstructured text using LLMs
- Builds hierarchical knowledge graphs with community detection (Leiden algorithm)
- Generates community summaries at multiple levels of granularity
- Outputs structured Parquet files with entities, relationships, communities

**Why we should use it:**
- Entity and relationship extraction is our most complex build. GraphRAG has battle-tested extraction prompts refined over 30K+ user community
- Leiden-based community detection is mathematically superior to our current text+embedding clustering
- Direct Neo4j integration documented (load Parquet → Neo4j)
- MIT license — no restrictions

**How we use it:**
- Run GraphRAG indexing pipeline on batches of signals/transcripts/documents
- Extract entities and relationships for entity resolution pipeline
- Use community detection to augment opportunity clustering
- Adopt (and customize) their extraction prompts as starting point

**What it saves:** 3-4 weeks of building custom extraction and community detection

**Integration approach:**
- Python microservice wrapping GraphRAG indexing
- Called from TypeScript pipeline after signal ingestion
- Output fed into entity resolution pipeline

**Limitations:**
- Designed for document corpora, not streaming signals — requires batch mode
- Requires tuning extraction prompts for PM domain (generic out of box)
- Python-only (requires polyglot architecture)

---

### 2.2 pyJedAI

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/AI-team-UoA/pyJedAI |
| **Stars** | 89 |
| **License** | Apache 2.0 |
| **Language** | Python |
| **Documentation** | pyjedai.readthedocs.io |

**What it does:**
- End-to-end entity resolution library
- Supports 5 generations of ER techniques: schema matching, scalable blocking, heterogeneous data, incremental/progressive resolution, LLM-powered matching
- Unsupervised methods that don't need labeled training data
- Integrates FAISS, Gensim, sentence-transformers for embedding-based matching

**Why we should use it:**
- Entity resolution is a 30+ year research problem. pyJedAI encapsulates this entire body of work
- Supports incremental resolution (critical for our streaming use case)
- Unsupervised — we don't have labeled training data
- Works without ground-truth files for evaluation (useful bootstrapping)

**How we use it:**
- Core engine for entity_resolution_service
- Blocking strategies for each entity type (reduce comparison space)
- Matching pipeline: string similarity + embedding similarity
- Progressive resolution for new entities against existing registry

**What it saves:** 2-3 weeks of building entity resolution from scratch

**Integration approach:**
- Python microservice at port 5001
- HTTP API: POST /resolve, POST /resolve-batch
- TypeScript calls via httpx/fetch

**Limitations:**
- Smaller community (89 stars) — academically maintained, not commercially
- May need custom blocking strategies for our entity types
- Documentation adequate but not extensive

---

### 2.3 Unstructured.io (Open Source)

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/Unstructured-IO/unstructured |
| **Stars** | 10,000+ |
| **License** | Apache 2.0 |
| **Language** | Python |
| **Documentation** | docs.unstructured.io/open-source |

**What it does:**
- Parses documents into structured elements: titles, narrative text, tables, lists, images
- Supports: PDF, DOCX, PPTX, XLSX, CSV, TXT, HTML, emails, images (OCR)
- OCR via Tesseract for scanned documents
- Table extraction as HTML
- Layout detection for complex documents

**Why we should use it:**
- We need to parse PPT, Word, Excel, PDF for manual document ingestion
- Most comprehensive open-source document parser available
- Returns structured elements with metadata (page numbers, sections, element types)
- Active development, large community

**How we use it:**
- Powers document_adapter for manual file ingestion
- Powers transcript_adapter for PDF/DOCX transcript files
- Each parsed element becomes a chunk → signal

**What it saves:** 1-2 weeks of building document parsing

**Integration approach:**
- Python microservice at port 5002
- HTTP API: POST /parse (multipart file upload)
- System dependencies: poppler (PDF), tesseract (OCR), libreoffice (Office docs)

**Limitations:**
- System dependencies (poppler, tesseract) can be tricky to install on some OSes
- Parsing quality varies by document complexity
- Large install footprint (~500MB with all dependencies)

---

## 3. Tier 2: Worth Evaluating — Partial Adoption

### 3.1 Argilla

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/argilla-io/argilla |
| **Stars** | 4,200+ |
| **License** | Apache 2.0 |
| **Language** | Python (FastAPI backend) |

**What it does:**
- Human feedback/annotation platform for LLM outputs
- Annotation UI with suggestion pre-filling
- Dataset versioning and quality tracking
- Inter-annotator agreement metrics
- Integration with fine-tuning pipelines

**Assessment for our use case:**
- Excellent for multi-PM feedback workflows (V3)
- Overkill for single-PM deployment (V2)
- Our MCP-based feedback mechanism is simpler and sufficient for V2

**Decision:** **DEFER to V3.** Monitor for multi-PM scenarios. For V2, use `feedback_service` via MCP tools.

---

### 3.2 WhyHow Knowledge Table

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/whyhow-ai/knowledge-table |
| **Stars** | 658 |
| **License** | MIT |
| **Language** | Python + React |

**What it does:**
- Schema-driven extraction from unstructured documents
- Define what to extract → it pulls structured data from documents into tables
- Links extracted facts to source chunks (provenance)
- Multi-document extraction and querying

**Assessment for our use case:**
- Could complement Unstructured.io for structured extraction
- Schema-driven approach is powerful for meeting transcript extraction
- "Extract action items, decisions, customer names, feature requests from this transcript"

**Decision:** **EVALUATE in Phase 3.** May add value for meeting transcript extraction once basic pipeline is working. Not critical path.

---

### 3.3 IdentityRAG / Tilores

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/tilotech/identity-rag-customer-insights-chatbot |
| **Stars** | 236 |
| **License** | MIT (demo), Commercial (Tilores core) |

**What it does:**
- Customer entity resolution and identity matching
- Creates "golden records" from disparate customer data sources
- LLM integration for customer insights chatbot

**Assessment for our use case:**
- Architectural inspiration for entity resolution approach
- Core Tilores engine is commercial — can't use for free
- Demo project useful as reference but not production-ready

**Decision:** **REFERENCE ONLY.** Take architectural inspiration. Use pyJedAI for actual implementation.

---

## 4. Tier 3: Reference Only — Architectural Inspiration

### 4.1 Qdrant-Neo4j-Ollama-GraphRAG

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/athrael-soju/qdrant-neo4j-ollama-graph-rag |
| **Stars** | Small |
| **License** | MIT |

**Useful for:** Reference architecture for combining vector DB (we use pgvector instead) with Neo4j for GraphRAG patterns.

---

### 4.2 SurveySmartAI

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/lennarddaw/SurveySmartAI |
| **Stars** | 1 |
| **License** | Not specified |

**Useful for:** BERT-based topic clustering approach, sarcasm detection in customer feedback. Reference only.

---

### 4.3 openline-ai/CustomerOS

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/openline-ai/openline-customer-os |
| **Stars** | ~50 |
| **License** | Apache 2.0 |

**Useful for:** B2B SaaS customer data model. Reference for entity schemas (customer, company, contact relationships).

---

### 4.4 LangGraph

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/langchain-ai/langgraph |
| **Stars** | 25,000+ |
| **License** | MIT |

**Assessment:**
- Excellent agent orchestration framework with state management
- Supports human-in-the-loop interrupts, parallel execution, durable workflows
- BUT: Adds a heavy Python dependency chain (LangChain ecosystem)
- Our system doesn't need a full agent runtime — Claude Code IS the agent
- Our pipeline is simpler than what LangGraph is designed for

**Decision:** **SKIP for V2.** Our pipeline can be orchestrated with simple TypeScript + BullMQ. Reconsider if workflow complexity increases significantly.

---

### 4.5 PipesHub

| Attribute | Detail |
|-----------|--------|
| **Repository** | github.com/pipeshub-ai/pipeshub-ai |
| **Stars** | 2,400 |
| **License** | Not specified |

**Assessment:** Enterprise search and workflow automation platform. Too broad for our focused PM use case. Reference for search patterns.

---

## 5. Summary: Adoption Matrix

| Project | Decision | Phase | Saves |
|---------|----------|-------|-------|
| **Microsoft GraphRAG** | ADOPT | Phase 3 (Week 9) | 3-4 weeks |
| **pyJedAI** | ADOPT | Phase 1 (Week 3) | 2-3 weeks |
| **Unstructured.io** | ADOPT | Phase 2 (Week 5) | 1-2 weeks |
| **Argilla** | DEFER | V3 | N/A |
| **Knowledge Table** | EVALUATE | Phase 3 | TBD |
| **IdentityRAG/Tilores** | REFERENCE | N/A | Arch inspiration |
| **LangGraph** | SKIP | N/A | N/A |

**Total estimated time saved: 6-9 weeks** (vs. building everything from scratch)

---

## 6. Risk Assessment

| Project | Risk | Mitigation |
|---------|------|------------|
| GraphRAG | Batch-oriented; may not fit streaming signals well | Batch process signals in 15-min windows |
| pyJedAI | Small community; may lack support | Core ER is well-documented. We add custom extensions. |
| Unstructured.io | System dependency complexity | Docker container isolates dependencies |
| All Python projects | Polyglot architecture friction | Clear HTTP API boundaries. Python is microservice only. |
