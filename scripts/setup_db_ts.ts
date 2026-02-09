import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function setupDatabase() {
  console.log('🚀 PM Intelligence System - Database Setup');
  console.log('==========================================\n');

  // Step 1: Get database credentials
  console.log('Step 1: Database Configuration\n');
  
  const DB_HOST = await question('Database host [localhost]: ') || 'localhost';
  const DB_PORT = parseInt(await question('Database port [5432]: ') || '5432');
  const DB_NAME = await question('Database name [pm_intelligence]: ') || 'pm_intelligence';
  const DB_USER = await question(`Database user [${process.env.USER || 'postgres'}]: `) || (process.env.USER || 'postgres');
  const DB_PASSWORD = await question('Database password (press Enter if no password): ');

  console.log('\nStep 2: Testing database connection...\n');

  // Step 2: Test connection
  const testPool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: 'postgres',
    user: DB_USER,
    password: DB_PASSWORD || undefined,
  });

  try {
    await testPool.query('SELECT 1');
    console.log('✓ Database connection successful\n');
  } catch (error: any) {
    console.error('❌ Database connection failed:', error.message);
    console.error('\nPlease check:');
    console.error('  1. PostgreSQL service is running');
    console.error('  2. Database credentials are correct');
    console.error('  3. User has permission to create databases');
    rl.close();
    process.exit(1);
  }

  // Step 3: Create database
  console.log(`Step 3: Creating database '${DB_NAME}'...\n`);
  
  try {
    await testPool.query(`CREATE DATABASE ${DB_NAME}`);
    console.log(`✓ Database '${DB_NAME}' created\n`);
  } catch (error: any) {
    if (error.code === '42P04') {
      console.log(`⚠️  Database '${DB_NAME}' already exists (continuing...)\n`);
    } else {
      console.error('❌ Failed to create database:', error.message);
      rl.close();
      process.exit(1);
    }
  }

  await testPool.end();

  // Step 4: Create .env file
  console.log('Step 4: Creating .env file...\n');
  
  const envContent = `DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
PORT=3000
API_HOST=0.0.0.0
ENABLE_RBAC=false
`;

  require('fs').writeFileSync('.env', envContent);
  console.log('✓ .env file created\n');

  // Step 5: Run migrations
  console.log('Step 5: Running database migrations...\n');

  const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD || undefined,
  });

  try {
    // Read and execute schema
    const schemaPath = join(process.cwd(), 'specs/sql_schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('✓ Schema migrated successfully\n');

    // Read and execute indexes
    try {
      const indexesPath = join(process.cwd(), 'backend/db/indexes.sql');
      const indexes = readFileSync(indexesPath, 'utf-8');
      await pool.query(indexes);
      console.log('✓ Indexes created successfully\n');
    } catch (indexError: any) {
      if (!indexError.message.includes('already exists')) {
        console.warn('⚠️  Index creation warning:', indexError.message);
      }
    }

    console.log('✓ Migrations completed\n');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    rl.close();
    process.exit(1);
  } finally {
    await pool.end();
  }

  // Step 6: Verify setup
  console.log('Step 6: Verifying setup...\n');

  const verifyPool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD || undefined,
  });

  try {
    const tables = ['signals', 'opportunities', 'judgments', 'artifacts'];
    for (const table of tables) {
      const result = await verifyPool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [table]
      );
      
      if (result.rows[0].exists) {
        console.log(`✓ Table '${table}': EXISTS`);
      } else {
        console.error(`❌ Table '${table}': MISSING`);
        rl.close();
        process.exit(1);
      }
    }

    // Check indexes
    const indexResult = await verifyPool.query(
      `SELECT COUNT(*) as count 
       FROM pg_indexes 
       WHERE tablename IN ('signals', 'opportunities', 'judgments', 'artifacts')`
    );
    const indexCount = parseInt(indexResult.rows[0].count);
    console.log(`✓ Database indexes: ${indexCount} indexes found\n`);
  } catch (error: any) {
    console.warn('⚠️  Verification warning:', error.message);
  } finally {
    await verifyPool.end();
  }

  rl.close();

  console.log('✅ Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Seed sample data (optional): npm run seed');
  console.log('2. Start API server: npm start');
  console.log('3. Test API: curl http://localhost:3000/health');
  console.log('');
}

setupDatabase().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
