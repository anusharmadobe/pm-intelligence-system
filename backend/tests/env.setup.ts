// Force test database settings - don't use production database for tests!
// Use explicit assignment instead of || to override any .env settings
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5433';
process.env.DB_NAME = 'pm_intelligence_test';
process.env.DB_USER = process.env.DB_USER || 'anusharm';
process.env.DB_PASSWORD = '';
process.env.SLACK_ONLY_ENABLED = 'true';

// Use mock LLM and embedding providers for tests to avoid API costs and improve test speed
process.env.LLM_PROVIDER = 'mock';
process.env.EMBEDDING_PROVIDER = 'mock';
