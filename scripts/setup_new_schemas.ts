#!/usr/bin/env ts-node
import 'dotenv/config';
import { getDbPool, closeDbPool } from '../backend/db/connection';
import { readFileSync } from 'fs';
import { join } from 'path';

async function setupNewSchemas() {
  const pool = getDbPool();
  
  try {
    // Install pgvector
    console.log('Installing pgvector extension...');
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('✓ pgvector extension installed');
    } catch (e: any) {
      console.log('⚠ pgvector:', e.message);
    }
    
    // Channel schema
    console.log('Applying channel schema...');
    try {
      const channelSchema = readFileSync(join(process.cwd(), 'backend/db/channel_schema.sql'), 'utf-8');
      await pool.query(channelSchema);
      console.log('✓ Channel schema applied');
    } catch (e: any) {
      console.log('⚠ Channel schema:', e.message.split('\n')[0]);
    }
    
    // Theme hierarchy schema
    console.log('Applying theme hierarchy schema...');
    try {
      const themeSchema = readFileSync(join(process.cwd(), 'backend/db/theme_hierarchy_schema.sql'), 'utf-8');
      await pool.query(themeSchema);
      console.log('✓ Theme hierarchy schema applied');
    } catch (e: any) {
      console.log('⚠ Theme schema:', e.message.split('\n')[0]);
    }
    
    // Embedding schema
    console.log('Applying embedding schema...');
    try {
      const embeddingSchema = readFileSync(join(process.cwd(), 'backend/db/embedding_schema.sql'), 'utf-8');
      await pool.query(embeddingSchema);
      console.log('✓ Embedding schema applied');
    } catch (e: any) {
      console.log('⚠ Embedding schema:', e.message.split('\n')[0]);
    }
    
    // Verify tables
    console.log('\nVerifying tables...');
    const tables = ['signals', 'slack_channels', 'theme_hierarchy', 'signal_theme_hierarchy', 'signal_embeddings', 'embedding_queue'];
    for (const table of tables) {
      const result = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
        [table]
      );
      const exists = result.rows[0].exists;
      console.log(exists ? '  ✓' : '  ✗', table);
    }
    
    // Check pgvector
    const extResult = await pool.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    if (extResult.rows.length > 0) {
      console.log('  ✓ pgvector version:', extResult.rows[0].extversion);
    } else {
      console.log('  ✗ pgvector not installed');
    }
    
    console.log('\n✓ Schema setup complete!');
  } finally {
    await closeDbPool();
  }
}

setupNewSchemas().catch(console.error);
