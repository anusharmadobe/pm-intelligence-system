# Complete Setup: Create User and Database

## Step 1: Create PostgreSQL User

You need to create the user first. Here are your options:

### Option A: Using psql (Recommended)

Open a terminal and run:

```bash
# Try to connect to PostgreSQL
psql -U postgres -d postgres
```

If that doesn't work, try:
```bash
psql -U $(whoami) -d postgres
```

Or find psql and use full path:
```bash
/opt/homebrew/opt/postgresql@17/bin/psql -U postgres -d postgres
```

Once connected, run:
```sql
CREATE USER anusharm WITH PASSWORD 'pm_intelligence' CREATEDB SUPERUSER;
```

Verify it worked:
```sql
SELECT rolname, rolcreatedb, rolsuper FROM pg_roles WHERE rolname = 'anusharm';
```

Exit:
```sql
\q
```

### Option B: One-liner (if psql is accessible)

```bash
psql -U postgres -d postgres -c "CREATE USER anusharm WITH PASSWORD 'pm_intelligence' CREATEDB SUPERUSER;"
```

### Option C: If user already exists, update it

```sql
ALTER USER anusharm WITH PASSWORD 'pm_intelligence' CREATEDB SUPERUSER;
```

## Step 2: Run Database Setup

After creating the user, run:

```bash
cd /Users/anusharm/learn/PM_cursor_system
DB_USER=anusharm DB_PASSWORD=pm_intelligence npm run setup-db-auto
```

This will:
1. ✅ Test database connection
2. ✅ Create `pm_intelligence` database
3. ✅ Create `.env` file
4. ✅ Run schema migrations
5. ✅ Create indexes
6. ✅ Verify setup

## Step 3: Verify Everything Works

```bash
npm run check
```

You should see:
```
✅ Database connection: OK
✅ Table 'signals': EXISTS
✅ Table 'opportunities': EXISTS
✅ Table 'judgments': EXISTS
✅ Table 'artifacts': EXISTS
✅ Database indexes: X indexes found
```

## Troubleshooting

### "psql: command not found"
- Add PostgreSQL to PATH: `export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"`
- Or use full path: `/opt/homebrew/opt/postgresql@17/bin/psql`

### "Connection refused"
- Start PostgreSQL: `brew services start postgresql@17`
- Or open Postgres.app if using that

### "Password authentication failed"
- Make sure you created the user first (Step 1)
- Check the password is exactly: `pm_intelligence`

### "Permission denied"
- You may need to connect as postgres superuser first
- Or use: `sudo -u postgres psql`

## Quick Reference

**User Details:**
- Username: `anusharm`
- Password: `pm_intelligence`
- Privileges: CREATEDB, SUPERUSER

**Database Details:**
- Database name: `pm_intelligence`
- Host: `localhost`
- Port: `5432`
