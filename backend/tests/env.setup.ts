process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5433';
process.env.DB_NAME = process.env.DB_NAME || 'pm_intelligence_test';
process.env.DB_USER = process.env.DB_USER || 'anusharm';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '';
process.env.SLACK_ONLY_ENABLED = process.env.SLACK_ONLY_ENABLED || 'true';

// Use mock LLM and embedding providers for tests to avoid API costs and improve test speed
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER_TEST || 'mock';
process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER_TEST || 'mock';
