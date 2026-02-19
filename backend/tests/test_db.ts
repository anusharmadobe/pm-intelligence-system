import { execSync } from 'child_process';
import { getDbPool, closeDbPool } from '../db/connection';
import { clearCustomerCache } from '../services/slack_entity_helpers';

// Always use test database for migrations in test environment
const MIGRATE_ENV = {
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || '5433',
  DB_NAME: process.env.DB_NAME || 'pm_intelligence_test',
  DB_USER: process.env.DB_USER || 'anusharm',
  DB_PASSWORD: process.env.DB_PASSWORD || ''
};

let migrationsApplied = false;

export async function runMigrations(): Promise<void> {
  if (migrationsApplied) return;

  // Close any existing database pool to ensure fresh connection with test DB settings
  await closeDbPool();

  const env = { ...process.env, ...MIGRATE_ENV };
  try {
    execSync('npm run migrate', { env, stdio: 'pipe' });
  } catch (error: any) {
    const message = error?.stderr?.toString() || error?.stdout?.toString() || error?.message || '';
    if (!message.includes('relation "signals" already exists')) {
      throw error;
    }
  }
  migrationsApplied = true;

  // Close pool again after migrations to ensure tests create fresh connections
  await closeDbPool();
}

export async function resetDatabase(): Promise<void> {
  const pool = getDbPool();
  await pool.query('TRUNCATE TABLE opportunity_signals CASCADE');
  await pool.query('TRUNCATE TABLE opportunities CASCADE');
  await pool.query('TRUNCATE TABLE judgments CASCADE');
  await pool.query('TRUNCATE TABLE artifacts CASCADE');
  await pool.query('TRUNCATE TABLE signal_entities CASCADE');
  await pool.query('TRUNCATE TABLE customer_issue_reports CASCADE');
  await pool.query('TRUNCATE TABLE customer_feature_usage CASCADE');
  await pool.query('TRUNCATE TABLE issues CASCADE');
  await pool.query('TRUNCATE TABLE features CASCADE');
  await pool.query('TRUNCATE TABLE slack_users CASCADE');
  await pool.query('TRUNCATE TABLE customers CASCADE');
  await pool.query('TRUNCATE TABLE slack_messages CASCADE');
  await pool.query('TRUNCATE TABLE signals CASCADE');
  
  // New tables from Phase 1-3
  try {
    await pool.query('TRUNCATE TABLE slack_channels CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE signal_theme_hierarchy CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE theme_hierarchy CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE signal_embeddings CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE embedding_queue CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE entity_aliases CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE entity_registry CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE entity_resolution_log CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE entity_merge_history CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE neo4j_sync_backlog CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE feedback_log CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE prompt_versions CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE agent_activity_log CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE agent_version_history CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE agent_registry CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE system_metrics CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE alerts CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE graphrag_communities CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE source_registry CASCADE');
  } catch (_e) { /* Table may not exist */ }
  try {
    await pool.query('TRUNCATE TABLE audit_log CASCADE');
  } catch (_e) { /* Table may not exist */ }
  clearCustomerCache();
}

export async function shutdownDatabase(): Promise<void> {
  await closeDbPool();
}
