import { Pool } from 'pg';

async function createDatabaseUser() {
  console.log('🔐 Creating PostgreSQL User');
  console.log('===========================\n');

  const DB_HOST = process.env.DB_HOST || 'localhost';
  const DB_PORT = parseInt(process.env.DB_PORT || '5432');
  const NEW_USER = 'anusharm';
  const NEW_PASSWORD = 'pm_intelligence';
  const DB_NAME = 'pm_intelligence';

  // Try to connect as postgres superuser first, then try current user
  const superUsers = ['postgres', process.env.USER || 'anusharm'];
  
  let connected = false;
  let adminPool: Pool | null = null;

  for (const adminUser of superUsers) {
    console.log(`Trying to connect as '${adminUser}'...`);
    
    const poolConfig: any = {
      host: DB_HOST,
      port: DB_PORT,
      database: 'postgres',
      user: adminUser,
    };

    try {
      adminPool = new Pool(poolConfig);
      await adminPool.query('SELECT 1');
      console.log(`✓ Connected as '${adminUser}'\n`);
      connected = true;
      break;
    } catch (error: any) {
      console.log(`✗ Failed to connect as '${adminUser}': ${error.message}`);
      if (adminPool) {
        await adminPool.end();
        adminPool = null;
      }
    }
  }

  if (!connected || !adminPool) {
    console.error('\n❌ Cannot connect to PostgreSQL as any admin user');
    console.error('Please ensure PostgreSQL is running and you have admin access');
    console.error('\nYou may need to:');
    console.error('1. Start PostgreSQL: brew services start postgresql@17');
    console.error('2. Connect manually: psql -U postgres -d postgres');
    console.error('3. Then run: CREATE USER anusharm WITH PASSWORD \'pm_intelligence\';');
    console.error('4. Then run: ALTER USER anusharm CREATEDB;');
    process.exit(1);
  }

  try {
    // Check if user exists
    console.log(`Checking if user '${NEW_USER}' exists...`);
    const userCheck = await adminPool.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [NEW_USER]
    );

    if (userCheck.rows.length > 0) {
      console.log(`⚠️  User '${NEW_USER}' already exists`);
      console.log('Updating password and privileges...\n');
      
      // Update password
      await adminPool.query(
        `ALTER USER ${NEW_USER} WITH PASSWORD $1`,
        [NEW_PASSWORD]
      );
      console.log('✓ Password updated');
      
      // Grant privileges
      await adminPool.query(`ALTER USER ${NEW_USER} CREATEDB`);
      await adminPool.query(`ALTER USER ${NEW_USER} WITH SUPERUSER`);
      console.log('✓ Privileges granted (CREATEDB, SUPERUSER)');
    } else {
      console.log(`Creating user '${NEW_USER}'...\n`);
      
      // Create user with password and privileges
      await adminPool.query(
        `CREATE USER ${NEW_USER} WITH PASSWORD $1 CREATEDB SUPERUSER`,
        [NEW_PASSWORD]
      );
      console.log('✓ User created');
      console.log('✓ Privileges granted (CREATEDB, SUPERUSER)');
    }

    console.log('\n✅ User setup complete!');
    console.log(`   Username: ${NEW_USER}`);
    console.log(`   Password: ${NEW_PASSWORD}`);
    console.log(`   Privileges: CREATEDB, SUPERUSER\n`);

  } catch (error: any) {
    console.error('\n❌ Failed to create/update user:', error.message);
    
    if (error.message.includes('permission denied')) {
      console.error('\nYou may need to run this as PostgreSQL superuser.');
      console.error('Try connecting as postgres user:');
      console.error('  psql -U postgres -d postgres');
      console.error('Then run:');
      console.error(`  CREATE USER ${NEW_USER} WITH PASSWORD '${NEW_PASSWORD}' CREATEDB SUPERUSER;`);
    }
    
    await adminPool.end();
    process.exit(1);
  } finally {
    if (adminPool) {
      await adminPool.end();
    }
  }
}

createDatabaseUser().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
