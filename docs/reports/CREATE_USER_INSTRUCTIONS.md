# Create PostgreSQL User Instructions

## Quick Method

Run this command in your terminal (it will prompt for PostgreSQL admin password if needed):

```bash
# Try to find and use psql
/opt/homebrew/opt/postgresql@17/bin/psql -U postgres -d postgres -f scripts/create_user.sql

# Or if that doesn't work, try:
psql -U postgres -d postgres -f scripts/create_user.sql

# Or connect interactively:
psql -U postgres -d postgres
```

Then copy and paste these SQL commands:

```sql
CREATE USER anusharm WITH PASSWORD 'pm_intelligence' CREATEDB SUPERUSER;
```

Type `\q` to exit.

## Alternative: Manual Steps

1. **Open terminal and connect to PostgreSQL:**
   ```bash
   psql -U postgres -d postgres
   ```
   
   If that doesn't work, try:
   ```bash
   psql -U $(whoami) -d postgres
   ```

2. **Run these SQL commands:**
   ```sql
   CREATE USER anusharm WITH PASSWORD 'pm_intelligence' CREATEDB SUPERUSER;
   ```

3. **Verify user was created:**
   ```sql
   SELECT rolname, rolcreatedb, rolsuper FROM pg_roles WHERE rolname = 'anusharm';
   ```
   
   You should see:
   ```
    rolname  | rolcreatedb | rolsuper 
   ----------+-------------+----------
    anusharm | t           | t
   ```

4. **Exit psql:**
   ```sql
   \q
   ```

## After Creating User

Once the user is created, run:

```bash
cd /Users/anusharm/learn/PM_cursor_system
DB_USER=anusharm DB_PASSWORD=pm_intelligence npm run setup-db-auto
```

This will:
- Create the database
- Create .env file
- Run migrations
- Set up indexes
