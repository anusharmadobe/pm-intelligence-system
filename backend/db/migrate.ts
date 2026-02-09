import 'dotenv/config';
import { getDbPool } from './connection';
import { readFileSync } from 'fs';
import { join } from 'path';

async function migrate() {
  const pool = getDbPool();
  
  try {
    // Run schema migration
    const schemaPath = join(process.cwd(), 'specs/sql_schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    try {
      await pool.query(schema);
      console.log('✓ Schema migrated successfully');
    } catch (schemaError: any) {
      if (schemaError.message.includes('already exists')) {
        console.warn('Schema already exists, continuing with supplemental migrations');
      } else {
        throw schemaError;
      }
    }
    
    // Run indexes migration
    try {
      const indexesPath = join(process.cwd(), 'backend/db/indexes.sql');
      const indexes = readFileSync(indexesPath, 'utf-8');
      await pool.query(indexes);
      console.log('✓ Indexes created successfully');
    } catch (indexError: any) {
      // Indexes might already exist, which is fine
      if (!indexError.message.includes('already exists')) {
        console.warn('Index creation warning:', indexError.message);
      }
    }

    // Run Slack-only supplemental schema (optional)
    try {
      const slackSchemaPath = join(process.cwd(), 'backend/db/slack_only_schema.sql');
      const slackSchema = readFileSync(slackSchemaPath, 'utf-8');
      await pool.query(slackSchema);
      console.log('✓ Slack-only schema applied successfully');
    } catch (slackSchemaError: any) {
      if (!slackSchemaError.message.includes('ENOENT')) {
        console.warn('Slack-only schema warning:', slackSchemaError.message);
      }
    }

    // Run Slack-only supplemental indexes (optional)
    try {
      const slackIndexesPath = join(process.cwd(), 'backend/db/slack_only_indexes.sql');
      const slackIndexes = readFileSync(slackIndexesPath, 'utf-8');
      await pool.query(slackIndexes);
      console.log('✓ Slack-only indexes created successfully');
    } catch (slackIndexesError: any) {
      if (!slackIndexesError.message.includes('ENOENT')) {
        console.warn('Slack-only indexes warning:', slackIndexesError.message);
      }
    }

    // Run channel registry schema
    try {
      const channelSchemaPath = join(process.cwd(), 'backend/db/channel_schema.sql');
      const channelSchema = readFileSync(channelSchemaPath, 'utf-8');
      await pool.query(channelSchema);
      console.log('✓ Channel registry schema applied successfully');
    } catch (channelSchemaError: any) {
      if (!channelSchemaError.message.includes('ENOENT')) {
        console.warn('Channel schema warning:', channelSchemaError.message);
      }
    }

    // Run theme hierarchy schema (optional)
    try {
      const themeHierarchyPath = join(process.cwd(), 'backend/db/theme_hierarchy_schema.sql');
      const themeHierarchy = readFileSync(themeHierarchyPath, 'utf-8');
      await pool.query(themeHierarchy);
      console.log('✓ Theme hierarchy schema applied successfully');
    } catch (themeHierarchyError: any) {
      if (!themeHierarchyError.message.includes('ENOENT')) {
        console.warn('Theme hierarchy schema warning:', themeHierarchyError.message);
      }
    }

    // Install pgvector extension and run embedding schema (optional)
    try {
      // First try to install pgvector extension
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('✓ pgvector extension installed');
      
      const embeddingSchemaPath = join(process.cwd(), 'backend/db/embedding_schema.sql');
      const embeddingSchema = readFileSync(embeddingSchemaPath, 'utf-8');
      await pool.query(embeddingSchema);
      console.log('✓ Embedding schema applied successfully');
    } catch (embeddingError: any) {
      if (embeddingError.message.includes('ENOENT')) {
        // File doesn't exist yet, skip silently
      } else if (embeddingError.message.includes('extension') || embeddingError.message.includes('vector')) {
        console.warn('pgvector extension not available - embedding features will be disabled');
      } else {
        console.warn('Embedding schema warning:', embeddingError.message);
      }
    }
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
