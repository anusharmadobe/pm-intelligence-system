import * as dotenv from 'dotenv';
dotenv.config();

import { getDbPool } from '../backend/db/connection';
import { getAllSignals } from '../backend/processing/signal_extractor';
import { getAllOpportunities } from '../backend/services/opportunity_service';

/**
 * Check if the system is properly set up
 */
async function checkSetup() {
  console.log('🔍 Checking PM Intelligence System Setup...\n');

  // Check database connection
  try {
    const pool = getDbPool();
    await pool.query('SELECT 1');
    console.log('✅ Database connection: OK');
  } catch (error: any) {
    console.error('❌ Database connection: FAILED');
    console.error('   Error:', error.message);
    console.error('   Make sure PostgreSQL is running and .env is configured');
    process.exit(1);
  }

  // Check tables exist
  try {
    const pool = getDbPool();
    const tables = ['signals', 'opportunities', 'judgments', 'artifacts'];
    
    for (const table of tables) {
      const result = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [table]
      );
      
      if (result.rows[0].exists) {
        console.log(`✅ Table '${table}': EXISTS`);
      } else {
        console.error(`❌ Table '${table}': MISSING`);
        console.error('   Run: npm run migrate');
        process.exit(1);
      }
    }
  } catch (error: any) {
    console.error('❌ Table check: FAILED');
    console.error('   Error:', error.message);
    process.exit(1);
  }

  // Check indexes
  try {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM pg_indexes 
       WHERE tablename IN ('signals', 'opportunities', 'judgments', 'artifacts')`
    );
    const indexCount = parseInt(result.rows[0].count);
    if (indexCount > 0) {
      console.log(`✅ Database indexes: ${indexCount} indexes found`);
    } else {
      console.warn('⚠️  Database indexes: No indexes found (performance may be impacted)');
      console.warn('   Run: psql -d pm_intelligence -f backend/db/indexes.sql');
    }
  } catch (error: any) {
    console.warn('⚠️  Index check: Could not verify indexes');
  }

  // Check data
  try {
    const signals = await getAllSignals();
    const opportunities = await getAllOpportunities();
    
    console.log(`\n📊 Current Data:`);
    console.log(`   Signals: ${signals.length}`);
    console.log(`   Opportunities: ${opportunities.length}`);
    
    if (signals.length === 0) {
      console.log('\n💡 Tip: Run "npm run seed" to add sample data');
    }
  } catch (error: any) {
    console.warn('⚠️  Data check: Could not retrieve data');
  }

  // Check environment variables
  console.log(`\n⚙️  Environment:`);
  const envVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'PORT'];
  let envOk = true;
  
  for (const envVar of envVars) {
    if (process.env[envVar]) {
      const value = envVar === 'DB_PASSWORD' ? '***' : process.env[envVar];
      console.log(`   ${envVar}: ${value}`);
    } else {
      console.warn(`   ${envVar}: NOT SET`);
      envOk = false;
    }
  }

  if (!envOk) {
    console.warn('\n⚠️  Some environment variables are missing');
    console.warn('   Check your .env file or environment variables');
  }

  console.log('\n✅ Setup check complete!');
  console.log('\nNext steps:');
  console.log('1. Start API server: npm start');
  console.log('2. Configure integrations: See SETUP_INTEGRATIONS.md');
  console.log('3. Use Cursor extension commands');
  
  process.exit(0);
}

checkSetup().catch((error) => {
  console.error('Setup check failed:', error);
  process.exit(1);
});
