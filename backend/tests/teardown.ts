/**
 * Global teardown for Jest tests
 * Ensures all async operations are cleaned up properly
 */

import { closeDbPool } from '../db/connection';
import { closeSharedRedis } from '../config/redis';

afterAll(async () => {
  // Close all database connections
  try {
    await closeDbPool();
  } catch (error) {
    console.warn('Error closing database pool:', error);
  }

  // Close Redis connections
  try {
    await closeSharedRedis();
  } catch (error) {
    console.warn('Error closing Redis:', error);
  }

  // Give time for cleanup
  await new Promise(resolve => setTimeout(resolve, 500));
});
