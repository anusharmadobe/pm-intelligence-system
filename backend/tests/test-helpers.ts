/**
 * Test Helpers and Utilities
 *
 * Common utilities for testing backend services
 */

import { Pool, PoolClient } from 'pg';
import { getDbPool } from '../db/connection';

export interface TestContext {
  pool: Pool;
  client?: PoolClient;
}

/**
 * Set up test database connection
 */
export async function setupTestDb(): Promise<TestContext> {
  const pool = getDbPool();
  return { pool };
}

/**
 * Clean up test database
 */
export async function cleanupTestDb(context: TestContext): Promise<void> {
  if (context.client) {
    context.client.release();
  }
}

/**
 * Start a transaction for isolated testing
 */
export async function beginTransaction(context: TestContext): Promise<void> {
  context.client = await context.pool.connect();
  await context.client.query('BEGIN');
}

/**
 * Rollback transaction (cleanup after test)
 */
export async function rollbackTransaction(context: TestContext): Promise<void> {
  if (context.client) {
    await context.client.query('ROLLBACK');
    context.client.release();
    context.client = undefined;
  }
}

/**
 * Truncate all tables (for integration tests)
 */
export async function truncateAllTables(context: TestContext): Promise<void> {
  const tables = [
    'user_activity_log',
    'feedback_tickets',
    'report_runs',
    'report_schedules',
    'custom_dashboards',
    'notification_preferences',
    'saved_filters',
    'user_preferences',
    'error_occurrences',
    'error_aggregation',
    'tracing_spans',
    'performance_metrics',
    'neo4j_sync_dead_letter',
    'neo4j_sync_backlog',
    'api_key_usage_log',
    'api_keys',
    'cost_tracking_events',
    'budget_allocations',
    'agent_configs',
    'opportunities',
    'signals'
  ];

  const client = context.client || context.pool;

  for (const table of tables) {
    try {
      await client.query(`TRUNCATE TABLE ${table} CASCADE`);
    } catch (error) {
      // Table might not exist, continue
    }
  }
}

/**
 * Create test user
 */
export async function createTestUser(
  context: TestContext,
  userData: {
    id?: string;
    email: string;
    name?: string;
  } = { email: 'test@example.com' }
) {
  const client = context.client || context.pool;
  const userId = userData.id || 'test-user-' + Date.now();

  return {
    id: userId,
    email: userData.email,
    name: userData.name || 'Test User'
  };
}

/**
 * Create test API key
 */
export async function createTestApiKey(
  context: TestContext,
  options: {
    name?: string;
    scopes?: string[];
    expires_at?: Date;
  } = {}
) {
  const client = context.client || context.pool;
  const apiKey = `pk_test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const keyHash = 'test_hash_' + Date.now();

  const result = await client.query(
    `INSERT INTO api_keys (id, name, key_hash, key_prefix, scopes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [
      'test-key-' + Date.now(),
      options.name || 'Test API Key',
      keyHash,
      'pk_test',
      options.scopes || ['read:signals', 'write:opportunities']
    ]
  );

  return {
    ...result.rows[0],
    plainKey: apiKey
  };
}

/**
 * Create test signal
 */
export async function createTestSignal(
  context: TestContext,
  signalData: {
    content?: string;
    source?: string;
    metadata?: any;
  } = {}
) {
  const client = context.client || context.pool;

  const result = await client.query(
    `INSERT INTO signals (id, content, source, source_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [
      'signal-' + Date.now(),
      signalData.content || 'Test signal content',
      signalData.source || 'test',
      'test-' + Date.now(),
      JSON.stringify(signalData.metadata || {})
    ]
  );

  return result.rows[0];
}

/**
 * Create test opportunity
 */
export async function createTestOpportunity(
  context: TestContext,
  opportunityData: {
    title?: string;
    status?: string;
    priority?: string;
  } = {}
) {
  const client = context.client || context.pool;

  const result = await client.query(
    `INSERT INTO opportunities (id, title, status, priority, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING *`,
    [
      'opp-' + Date.now(),
      opportunityData.title || 'Test Opportunity',
      opportunityData.status || 'open',
      opportunityData.priority || 'medium'
    ]
  );

  return result.rows[0];
}

/**
 * Wait for async operation
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
  } = {}
): Promise<void> {
  const timeout = options.timeout || 5000;
  const interval = options.interval || 100;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error('Timeout waiting for condition');
}

/**
 * Mock environment variables
 */
export function mockEnv(vars: Record<string, string>): () => void {
  const original = { ...process.env };

  Object.assign(process.env, vars);

  return () => {
    process.env = original;
  };
}

/**
 * Generate random test data
 */
export const testData = {
  email: () => `test-${Date.now()}@example.com`,
  uuid: () => `${Date.now()}-${Math.random().toString(36).substring(7)}`,
  string: (length: number = 10) => Math.random().toString(36).substring(2, length + 2),
  number: (min: number = 0, max: number = 100) => Math.floor(Math.random() * (max - min + 1)) + min,
  boolean: () => Math.random() > 0.5,
  date: () => new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000)
};

/**
 * Assert helpers
 */
export const assert = {
  async throws(fn: () => Promise<any>, expectedError?: string | RegExp): Promise<void> {
    try {
      await fn();
      throw new Error('Expected function to throw but it did not');
    } catch (error: any) {
      if (error.message === 'Expected function to throw but it did not') {
        throw error;
      }
      if (expectedError) {
        if (typeof expectedError === 'string') {
          if (!error.message.includes(expectedError)) {
            throw new Error(`Expected error message to include "${expectedError}" but got "${error.message}"`);
          }
        } else {
          if (!expectedError.test(error.message)) {
            throw new Error(`Expected error message to match ${expectedError} but got "${error.message}"`);
          }
        }
      }
    }
  },

  async notThrows(fn: () => Promise<any>): Promise<void> {
    try {
      await fn();
    } catch (error: any) {
      throw new Error(`Expected function not to throw but got: ${error.message}`);
    }
  },

  async eventually(
    fn: () => Promise<boolean>,
    timeout: number = 5000,
    message: string = 'Condition not met'
  ): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await fn()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(message);
  }
};

/**
 * Performance testing helper
 */
export async function measurePerformance<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;

  console.log(`[Performance] ${name}: ${duration}ms`);

  return { result, duration };
}

/**
 * Load testing helper
 */
export async function runLoadTest(
  name: string,
  fn: () => Promise<any>,
  options: {
    iterations: number;
    concurrency: number;
  }
): Promise<{
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  successRate: number;
}> {
  const { iterations, concurrency } = options;
  const times: number[] = [];
  let successes = 0;
  let failures = 0;

  console.log(`[Load Test] ${name}: ${iterations} iterations, ${concurrency} concurrent`);

  const startTime = Date.now();

  // Run in batches with concurrency control
  for (let i = 0; i < iterations; i += concurrency) {
    const batch = Math.min(concurrency, iterations - i);
    const promises = Array.from({ length: batch }, async () => {
      const iterStart = Date.now();
      try {
        await fn();
        const iterTime = Date.now() - iterStart;
        times.push(iterTime);
        successes++;
      } catch (error) {
        failures++;
      }
    });

    await Promise.all(promises);
  }

  const totalTime = Date.now() - startTime;
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const successRate = successes / (successes + failures);

  console.log(`[Load Test] ${name} completed:`);
  console.log(`  Total: ${totalTime}ms`);
  console.log(`  Avg: ${avgTime.toFixed(2)}ms`);
  console.log(`  Min: ${minTime}ms`);
  console.log(`  Max: ${maxTime}ms`);
  console.log(`  Success Rate: ${(successRate * 100).toFixed(2)}%`);

  return { totalTime, avgTime, minTime, maxTime, successRate };
}
