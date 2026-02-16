import 'dotenv/config';
import { getDbPool } from './connection';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

async function migrate() {
  const pool = getDbPool();
  const client = await pool.connect();
  const lockKey = 12345;
  
  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    // Run schema migration
    const schemaPath = join(process.cwd(), 'specs/sql_schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    try {
      await client.query(schema);
      logger.info('Schema migrated successfully');
    } catch (schemaError: any) {
      if (schemaError.message.includes('already exists')) {
        logger.warn('Schema already exists, continuing with supplemental migrations');
      } else {
        throw schemaError;
      }
    }
    
    // Run indexes migration
    try {
      const indexesPath = join(process.cwd(), 'backend/db/indexes.sql');
      const indexes = readFileSync(indexesPath, 'utf-8');
      await client.query(indexes);
      logger.info('Indexes created successfully');
    } catch (indexError: any) {
      // Indexes might already exist, which is fine
      if (!indexError.message.includes('already exists')) {
        logger.warn('Index creation warning', { error: indexError.message });
      }
    }

    // Run Slack-only supplemental schema (optional)
    try {
      const slackSchemaPath = join(process.cwd(), 'backend/db/slack_only_schema.sql');
      const slackSchema = readFileSync(slackSchemaPath, 'utf-8');
      await client.query(slackSchema);
      logger.info('Slack-only schema applied successfully');
    } catch (slackSchemaError: any) {
      if (!slackSchemaError.message.includes('ENOENT')) {
        logger.warn('Slack-only schema warning', { error: slackSchemaError.message });
      }
    }

    // Run Slack-only supplemental indexes (optional)
    try {
      const slackIndexesPath = join(process.cwd(), 'backend/db/slack_only_indexes.sql');
      const slackIndexes = readFileSync(slackIndexesPath, 'utf-8');
      await client.query(slackIndexes);
      logger.info('Slack-only indexes created successfully');
    } catch (slackIndexesError: any) {
      if (!slackIndexesError.message.includes('ENOENT')) {
        logger.warn('Slack-only indexes warning', { error: slackIndexesError.message });
      }
    }

    // Run channel registry schema
    try {
      const channelSchemaPath = join(process.cwd(), 'backend/db/channel_schema.sql');
      const channelSchema = readFileSync(channelSchemaPath, 'utf-8');
      await client.query(channelSchema);
      logger.info('Channel registry schema applied successfully');
    } catch (channelSchemaError: any) {
      if (!channelSchemaError.message.includes('ENOENT')) {
        logger.warn('Channel schema warning', { error: channelSchemaError.message });
      }
    }

    // Run theme hierarchy schema (optional)
    try {
      const themeHierarchyPath = join(process.cwd(), 'backend/db/theme_hierarchy_schema.sql');
      const themeHierarchy = readFileSync(themeHierarchyPath, 'utf-8');
      await client.query(themeHierarchy);
      logger.info('Theme hierarchy schema applied successfully');
    } catch (themeHierarchyError: any) {
      if (!themeHierarchyError.message.includes('ENOENT')) {
        logger.warn('Theme hierarchy schema warning', { error: themeHierarchyError.message });
      }
    }

    // Install pgvector extension and run embedding schema (optional)
    try {
      // First try to install pgvector extension
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      logger.info('pgvector extension installed');
      
      const embeddingSchemaPath = join(process.cwd(), 'backend/db/embedding_schema.sql');
      const embeddingSchema = readFileSync(embeddingSchemaPath, 'utf-8');
      await client.query(embeddingSchema);
      logger.info('Embedding schema applied successfully');
    } catch (embeddingError: any) {
      if (embeddingError.message.includes('ENOENT')) {
        // File doesn't exist yet, skip silently
      } else if (embeddingError.message.includes('extension') || embeddingError.message.includes('vector')) {
        logger.warn('pgvector extension not available - embedding features will be disabled');
      } else {
        logger.warn('Embedding schema warning', { error: embeddingError.message });
      }
    }

    // Run V2 migrations (optional, additive)
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           filename TEXT PRIMARY KEY,
           applied_at TIMESTAMP DEFAULT NOW()
         )`
      );
      const migrationsDir = join(process.cwd(), 'backend/db/migrations');
      const migrationFiles = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

      for (const migrationFile of migrationFiles) {
        const alreadyApplied = await client.query(
          `SELECT 1 FROM schema_migrations WHERE filename = $1`,
          [migrationFile]
        );
        if (alreadyApplied.rows.length > 0) {
          continue;
        }
        const migrationPath = join(migrationsDir, migrationFile);
        const migrationSql = readFileSync(migrationPath, 'utf-8');
        try {
          await client.query(migrationSql);
          await client.query(
            `INSERT INTO schema_migrations (filename) VALUES ($1)`,
            [migrationFile]
          );
          logger.info('Migration applied', { migrationFile });
        } catch (migrationError: any) {
          if (!migrationError.message.includes('already exists')) {
            logger.warn('Migration warning', { migrationFile, error: migrationError.message });
          }
        }
      }
    } catch (migrationDirError: any) {
      if (!migrationDirError.message.includes('ENOENT')) {
      logger.warn('Migration directory warning', { error: migrationDirError.message });
      }
    }
    
    logger.info('Migration completed successfully');
  } catch (error) {
    logger.error('Migration failed', { error });
    process.exit(1);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    } catch (_err) {
      // ignore unlock errors
    }
    client.release();
    await pool.end();
  }
}

migrate();
