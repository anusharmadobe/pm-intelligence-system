import { Pool } from 'pg';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

async function setupDatabase() {
  console.log('🚀 PM Intelligence System - Database Setup (Auto)');
  console.log('=================================================\n');

  // Use defaults or environment variables
  const DB_HOST = process.env.DB_HOST || 'localhost';
  const DB_PORT = parseInt(process.env.DB_PORT || '5432');
  const DB_NAME = process.env.DB_NAME || 'pm_intelligence';
  const DB_USER = process.env.DB_USER || process.env.USER || 'postgres';
  const DB_PASSWORD = process.env.DB_PASSWORD || '';

  console.log('Configuration:');
  console.log(`  Host: ${DB_HOST}`);
  console.log(`  Port: ${DB_PORT}`);
  console.log(`  Database: ${DB_NAME}`);
  console.log(`  User: ${DB_USER}`);
  console.log(`  Password: ${DB_PASSWORD ? '***' : '(none)'}\n`);

  // Step 1: Test connection
  console.log('Step 1: Testing database connection...\n');

  const poolConfig: any = {
    host: DB_HOST,
    port: DB_PORT,
    database: 'postgres',
    user: DB_USER,
  };
  
  if (DB_PASSWORD) {
    poolConfig.password = DB_PASSWORD;
  }

  const testPool = new Pool(poolConfig);

  try {
    await testPool.query('SELECT 1');
    console.log('✓ Database connection successful\n');
  } catch (error: any) {
    console.error('❌ Database connection failed:', error.message);
    console.error('\nPlease check:');
    console.error('  1. PostgreSQL service is running');
    console.error('  2. Database credentials are correct');
    console.error('  3. User has permission to create databases');
    console.error('\nTo set custom credentials, use:');
    console.error('  DB_HOST=localhost DB_USER=youruser DB_PASSWORD=pass npm run setup-db-auto');
    process.exit(1);
  }

  // Step 2: Create database
  console.log(`Step 2: Creating database '${DB_NAME}'...\n`);
  
  try {
    await testPool.query(`CREATE DATABASE ${DB_NAME}`);
    console.log(`✓ Database '${DB_NAME}' created\n`);
  } catch (error: any) {
    if (error.code === '42P04') {
      console.log(`⚠️  Database '${DB_NAME}' already exists (continuing...)\n`);
    } else {
      console.error('❌ Failed to create database:', error.message);
      await testPool.end();
      process.exit(1);
    }
  }

  await testPool.end();

  // Step 3: Create .env file
  console.log('Step 3: Creating .env file...\n');
  
  const envContent = `DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
PORT=3000
API_HOST=0.0.0.0
ENABLE_RBAC=false
`;

  writeFileSync('.env', envContent);
  console.log('✓ .env file created\n');

  // Step 4: Run migrations
  console.log('Step 4: Running database migrations...\n');

  const dbPoolConfig: any = {
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
  };
  
  if (DB_PASSWORD) {
    dbPoolConfig.password = DB_PASSWORD;
  }

  const pool = new Pool(dbPoolConfig);

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
    await pool.end();
    process.exit(1);
  } finally {
    await pool.end();
  }

  // Step 5: Verify setup
  console.log('Step 5: Verifying setup...\n');

  const verifyPoolConfig: any = {
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
  };
  
  if (DB_PASSWORD) {
    verifyPoolConfig.password = DB_PASSWORD;
  }

  const verifyPool = new Pool(verifyPoolConfig);

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
        await verifyPool.end();
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

  console.log('✅ Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Verify setup: npm run check');
  console.log('2. Seed sample data (optional): npm run seed');
  console.log('3. Start API server: npm start');
  console.log('4. Test API: curl http://localhost:3000/health');
  console.log('');
}

setupDatabase().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
