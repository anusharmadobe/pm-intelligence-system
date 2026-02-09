#!/usr/bin/env ts-node
/**
 * pgvector Setup and Verification Script
 * 
 * This script helps set up and verify pgvector extension for the PM Intelligence System.
 * Run this before running migrations if you're using the embedding/search features.
 */

import { getDbPool, closeDbPool } from '../backend/db/connection';

interface PgVectorStatus {
  installed: boolean;
  version?: string;
  canCreateExtension: boolean;
  embeddingTableExists: boolean;
  embeddingCount: number;
  recommendations: string[];
}

async function checkPgVectorStatus(): Promise<PgVectorStatus> {
  const pool = getDbPool();
  const status: PgVectorStatus = {
    installed: false,
    canCreateExtension: false,
    embeddingTableExists: false,
    embeddingCount: 0,
    recommendations: []
  };

  try {
    // Check if pgvector extension exists
    const extResult = await pool.query(`
      SELECT extversion 
      FROM pg_extension 
      WHERE extname = 'vector'
    `);
    
    if (extResult.rows.length > 0) {
      status.installed = true;
      status.version = extResult.rows[0].extversion;
      console.log(`✓ pgvector extension is installed (version ${status.version})`);
    } else {
      console.log('✗ pgvector extension is NOT installed');
      
      // Try to create extension
      try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        status.installed = true;
        status.canCreateExtension = true;
        console.log('✓ Successfully installed pgvector extension');
        
        // Get version after install
        const versionResult = await pool.query(`
          SELECT extversion FROM pg_extension WHERE extname = 'vector'
        `);
        if (versionResult.rows.length > 0) {
          status.version = versionResult.rows[0].extversion;
        }
      } catch (createError: any) {
        console.log('✗ Cannot auto-install pgvector extension');
        status.recommendations.push(
          'Install pgvector: https://github.com/pgvector/pgvector#installation',
          'For macOS with Homebrew: brew install pgvector',
          'For Ubuntu/Debian: apt install postgresql-16-pgvector',
          'Then run: CREATE EXTENSION vector; in your database'
        );
      }
    }

    // Check if embedding tables exist
    const tableResult = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'signal_embeddings'
      ) as exists
    `);
    
    status.embeddingTableExists = tableResult.rows[0].exists;
    
    if (status.embeddingTableExists) {
      console.log('✓ signal_embeddings table exists');
      
      // Count embeddings
      const countResult = await pool.query('SELECT COUNT(*) FROM signal_embeddings');
      status.embeddingCount = parseInt(countResult.rows[0].count);
      console.log(`  Embeddings stored: ${status.embeddingCount}`);
    } else {
      console.log('✗ signal_embeddings table does not exist');
      if (status.installed) {
        status.recommendations.push('Run migrations: npm run migrate');
      }
    }

    // Check for HNSW index
    if (status.embeddingTableExists) {
      const indexResult = await pool.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'signal_embeddings' 
        AND indexdef LIKE '%hnsw%'
      `);
      
      if (indexResult.rows.length > 0) {
        console.log('✓ HNSW index exists for fast similarity search');
      } else {
        console.log('! HNSW index not found - search may be slower');
        status.recommendations.push(
          'Create HNSW index for faster search:',
          'CREATE INDEX idx_signal_embeddings_hnsw ON signal_embeddings USING hnsw (embedding vector_cosine_ops)'
        );
      }
    }

  } catch (error: any) {
    console.error('Error checking pgvector status:', error.message);
  }

  return status;
}

async function checkDatabaseConnection(): Promise<boolean> {
  const pool = getDbPool();
  
  try {
    await pool.query('SELECT 1');
    console.log('✓ Database connection successful');
    return true;
  } catch (error: any) {
    console.error('✗ Database connection failed:', error.message);
    console.log('\nMake sure you have set the following environment variables:');
    console.log('  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD');
    return false;
  }
}

async function checkOtherTables(): Promise<void> {
  const pool = getDbPool();
  
  const tables = [
    'signals',
    'slack_channels',
    'theme_hierarchy',
    'signal_theme_hierarchy',
    'opportunities'
  ];
  
  console.log('\nChecking required tables:');
  
  for (const table of tables) {
    try {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        ) as exists
      `, [table]);
      
      const exists = result.rows[0].exists;
      console.log(`  ${exists ? '✓' : '✗'} ${table}`);
    } catch (error) {
      console.log(`  ✗ ${table} (error checking)`);
    }
  }
}

async function printSummary(status: PgVectorStatus): Promise<void> {
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  
  if (status.installed && status.embeddingTableExists) {
    console.log('✓ pgvector is fully set up and ready');
    console.log(`  Version: ${status.version}`);
    console.log(`  Embeddings: ${status.embeddingCount}`);
  } else if (status.installed) {
    console.log('⚠ pgvector extension is installed but tables are missing');
    console.log('  Run: npm run migrate');
  } else {
    console.log('✗ pgvector is not installed');
    console.log('  Semantic search features will be disabled');
    console.log('  Full-text search will still work');
  }
  
  if (status.recommendations.length > 0) {
    console.log('\nRecommendations:');
    status.recommendations.forEach(rec => console.log(`  - ${rec}`));
  }
}

async function main() {
  console.log('PM Intelligence System - pgvector Setup Check\n');
  console.log('========================================');
  
  // Check database connection first
  const connected = await checkDatabaseConnection();
  if (!connected) {
    process.exit(1);
  }
  
  console.log('\n========================================');
  console.log('pgvector STATUS');
  console.log('========================================');
  
  const status = await checkPgVectorStatus();
  
  await checkOtherTables();
  
  await printSummary(status);
  
  await closeDbPool();
  
  // Exit with error if pgvector is not set up and we can't fix it
  if (!status.installed && status.recommendations.length > 0) {
    console.log('\n⚠ Note: The system will work without pgvector,');
    console.log('  but semantic search features will be unavailable.');
    console.log('  Full-text search will still function normally.');
  }
}

main().catch(console.error);
