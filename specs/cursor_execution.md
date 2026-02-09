
# Cursor Execution Contract

Cursor MUST:
1. Implement SQL schema exactly.
2. Never merge layers.
3. Never introduce new entities.
4. Never infer missing requirements.
5. Never invoke LLMs outside allowed layers.

Build Order:
1. SQL schema
2. Signal ingestion
3. Opportunity detection
4. Judgment layer
5. Artifact generation
6. Cursor extension
7. Metrics
