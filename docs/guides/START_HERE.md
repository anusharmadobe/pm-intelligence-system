# 🚀 Start Here - Database Setup

## Current Status
✅ PostgreSQL 17 is installed on your system  
⚠️ `psql` command is not in your PATH  
⏳ npm dependencies need to be installed  

## Quick Setup (Run These Commands)

### 1. Add PostgreSQL to PATH

Open your terminal and run:

```bash
# Add PostgreSQL to PATH
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify it works
psql --version
```

If that doesn't work, try finding where PostgreSQL is installed:
```bash
find /opt/homebrew /usr/local -name psql 2>/dev/null
```

### 2. Start PostgreSQL Service

```bash
# Start PostgreSQL (choose one that works)
brew services start postgresql@17
# OR
brew services start postgresql
# OR if using Postgres.app, just open the app
```

Verify it's running:
```bash
pg_isready
# Should show: accepting connections
```

### 3. Install npm Dependencies

```bash
cd /Users/anusharm/learn/PM_cursor_system
npm install
```

If you get permission errors, try:
```bash
sudo npm install
# OR
npm install --prefix .
```

### 4. Run Database Setup Script

```bash
bash scripts/setup_database.sh
```

This interactive script will:
- Find psql
- Ask for your database credentials
- Create the database
- Create .env file
- Run migrations

### 5. Verify Everything Works

```bash
npm run check
```

You should see:
- ✅ Database connection: OK
- ✅ Table 'signals': EXISTS
- ✅ Table 'opportunities': EXISTS
- ✅ Table 'judgments': EXISTS
- ✅ Table 'artifacts': EXISTS

## Manual Setup (If Script Doesn't Work)

### Step 1: Create Database

```bash
# Find psql first
/opt/homebrew/opt/postgresql@17/bin/psql --version

# Create database (use full path if needed)
/opt/homebrew/opt/postgresql@17/bin/createdb pm_intelligence
# OR if psql is in PATH now:
createdb pm_intelligence
```

### Step 2: Create .env File

```bash
cat > .env << 'EOF'
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pm_intelligence
DB_USER=anusharm
DB_PASSWORD=
PORT=3000
API_HOST=0.0.0.0
ENABLE_RBAC=false
EOF
```

**Note:** Replace `anusharm` with your macOS username if different.

### Step 3: Run Migrations

```bash
npm run migrate
```

You should see:
```
✓ Schema migrated successfully
✓ Indexes created successfully
Migration completed successfully
```

### Step 4: Verify

```bash
npm run check
```

## Next Steps After Database Setup

1. ✅ Database is ready
2. ⏭️ Seed sample data: `npm run seed`
3. ⏭️ Start API server: `npm start`
4. ⏭️ Test API: `curl http://localhost:3000/health`
5. ⏭️ Later: Set up Slack MCP integration

## Need Help?

If you encounter issues:

1. **"psql: command not found"**
   - See Step 1 above to add PostgreSQL to PATH
   - Or use full path: `/opt/homebrew/opt/postgresql@17/bin/psql`

2. **"Connection refused"**
   - Start PostgreSQL: `brew services start postgresql@17`
   - Check: `pg_isready`

3. **"Database creation failed"**
   - Try: `createdb -U $(whoami) pm_intelligence`
   - Or create user: `createuser -s $(whoami)`

4. **npm install fails**
   - Try: `sudo npm install`
   - Or: `npm install --legacy-peer-deps`

## Once Database is Set Up

Run this to verify:
```bash
npm run check
```

Then we can proceed with:
- Seeding sample data
- Starting the API server
- Setting up Slack MCP integration (when you're ready)
