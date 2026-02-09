import { Pool } from 'pg';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

async function findAdminAndSetup() {
  console.log('🔍 Finding PostgreSQL Admin Access');
  console.log('==================================\n');

  const DB_HOST = process.env.DB_HOST || 'localhost';
  const DB_PORT = parseInt(process.env.DB_PORT || '5432');
  const NEW_USER = 'anusharm';
  const NEW_PASSWORD = 'pm_intelligence';
  const DB_NAME = 'pm_intelligence';

  // Try different admin users and methods
  const adminUsers = ['postgres', process.env.USER || 'anusharm'];
  const commonPasswords = ['', 'postgres', 'admin', 'password'];

  let adminPool: Pool | null = null;
  let connectedUser = '';

  // Method 1: Try connecting without password (peer/trust auth)
  console.log('Method 1: Trying peer/trust authentication...\n');
  
  for (const adminUser of adminUsers) {
    for (const password of commonPasswords) {
      const poolConfig: any = {
        host: DB_HOST,
        port: DB_PORT,
        database: 'postgres',
        user: adminUser,
      };

      if (password) {
        poolConfig.password = password;
      }

      try {
        console.log(`  Trying: ${adminUser}${password ? ' (with password)' : ' (no password)'}...`);
        adminPool = new Pool(poolConfig);
        await adminPool.query('SELECT 1');
        connectedUser = adminUser;
        console.log(`  ✓ Connected as '${adminUser}'\n`);
        break;
      } catch (error: any) {
        // Continue trying
      } finally {
        if (adminPool && connectedUser !== adminUser) {
          await adminPool.end();
          adminPool = null;
        }
      }
    }
    if (adminPool) break;
  }

  // Method 2: Try using psql command line
  if (!adminPool) {
    console.log('Method 2: Trying psql command line...\n');
    
    const psqlPaths = [
      '/opt/homebrew/opt/postgresql@17/bin/psql',
      '/opt/homebrew/opt/postgresql/bin/psql',
      '/usr/local/bin/psql',
      'psql'
    ];

    for (const psqlPath of psqlPaths) {
      try {
        // Try to execute psql command
        const testCmd = `${psqlPath} -U postgres -d postgres -c "SELECT 1" 2>&1`;
        execSync(testCmd, { timeout: 5000 });
        console.log(`  ✓ Found psql at: ${psqlPath}\n`);
        
        // Try to create user via command line
        try {
          const createUserCmd = `${psqlPath} -U postgres -d postgres -c "CREATE USER ${NEW_USER} WITH PASSWORD '${NEW_PASSWORD}' CREATEDB SUPERUSER;" 2>&1`;
          execSync(createUserCmd, { timeout: 5000 });
          console.log(`  ✓ User created via psql\n`);
          
          // Now connect with new user
          adminPool = new Pool({
            host: DB_HOST,
            port: DB_PORT,
            database: 'postgres',
            user: NEW_USER,
            password: NEW_PASSWORD,
          });
          await adminPool.query('SELECT 1');
          connectedUser = NEW_USER;
          break;
        } catch (error: any) {
          // User might already exist, try to connect
          try {
            adminPool = new Pool({
              host: DB_HOST,
              port: DB_PORT,
              database: 'postgres',
              user: NEW_USER,
              password: NEW_PASSWORD,
            });
            await adminPool.query('SELECT 1');
            connectedUser = NEW_USER;
            console.log(`  ✓ User already exists, connected\n`);
            break;
          } catch (e) {
            // Continue
          }
        }
      } catch (error: any) {
        // Continue trying
      }
    }
  }

  if (!adminPool) {
    console.error('❌ Could not find PostgreSQL admin access');
    console.error('\nPlease create the user manually:');
    console.error(`  psql -U postgres -d postgres`);
    console.error(`  CREATE USER ${NEW_USER} WITH PASSWORD '${NEW_PASSWORD}' CREATEDB SUPERUSER;`);
    process.exit(1);
  }

  // Create or update user
  console.log('🔐 Creating/Updating User');
  console.log('==========================\n');

  try {
    // Check if user exists
    const userCheck = await adminPool.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [NEW_USER]
    );

    if (userCheck.rows.length > 0) {
      console.log(`⚠️  User '${NEW_USER}' already exists`);
      console.log('Updating password and privileges...\n');
      
      // Escape single quotes in password
      const escapedPassword = NEW_PASSWORD.replace(/'/g, "''");
      await adminPool.query(
        `ALTER USER ${NEW_USER} WITH PASSWORD '${escapedPassword}' CREATEDB SUPERUSER`
      );
      console.log('✓ Password and privileges updated');
    } else {
      console.log(`Creating user '${NEW_USER}'...\n`);
      
      // Escape single quotes in password
      const escapedPassword = NEW_PASSWORD.replace(/'/g, "''");
      await adminPool.query(
        `CREATE USER ${NEW_USER} WITH PASSWORD '${escapedPassword}' CREATEDB SUPERUSER`
      );
      console.log('✓ User created with privileges');
    }

    console.log(`\n✅ User setup complete!`);
    console.log(`   Username: ${NEW_USER}`);
    console.log(`   Password: ${NEW_PASSWORD}`);
    console.log(`   Privileges: CREATEDB, SUPERUSER\n`);

  } catch (error: any) {
    console.error('\n❌ Failed to create/update user:', error.message);
    await adminPool.end();
    process.exit(1);
  } finally {
    if (adminPool && connectedUser !== NEW_USER) {
      await adminPool.end();
    }
  }

  // Now setup database with new user
  console.log('🗄️  Setting Up Database');
  console.log('=======================\n');

  const dbPool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: 'postgres',
    user: NEW_USER,
    password: NEW_PASSWORD,
  });

  try {
    // Create database
    console.log(`Creating database '${DB_NAME}'...`);
    try {
      await dbPool.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`✓ Database created\n`);
    } catch (error: any) {
      if (error.code === '42P04') {
        console.log(`⚠️  Database already exists (continuing...)\n`);
      } else {
        throw error;
      }
    }

    await dbPool.end();

    // Create .env file
    console.log('Creating .env file...');
    const envContent = `DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${NEW_USER}
DB_PASSWORD=${NEW_PASSWORD}
PORT=3000
API_HOST=0.0.0.0
ENABLE_RBAC=false
`;
    writeFileSync('.env', envContent);
    console.log('✓ .env file created\n');

    // Run migrations
    console.log('Running migrations...\n');
    const finalPool = new Pool({
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      user: NEW_USER,
      password: NEW_PASSWORD,
    });

    // Schema
    const schemaPath = join(process.cwd(), 'specs/sql_schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await finalPool.query(schema);
    console.log('✓ Schema migrated');

    // Indexes
    try {
      const indexesPath = join(process.cwd(), 'backend/db/indexes.sql');
      const indexes = readFileSync(indexesPath, 'utf-8');
      await finalPool.query(indexes);
      console.log('✓ Indexes created');
    } catch (indexError: any) {
      if (!indexError.message.includes('already exists')) {
        console.warn('⚠️  Index warning:', indexError.message);
      }
    }

    await finalPool.end();

    console.log('\n✅ Complete setup finished!\n');
    console.log('Next steps:');
    console.log('1. Verify: npm run check');
    console.log('2. Seed data (optional): npm run seed');
    console.log('3. Start API: npm start');

  } catch (error: any) {
    console.error('\n❌ Database setup failed:', error.message);
    await dbPool.end();
    process.exit(1);
  }
}

findAdminAndSetup().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
