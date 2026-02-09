# Database Setup Guide

## Step 1: Add PostgreSQL to PATH

Since PostgreSQL is installed but `psql` isn't in your PATH, add it:

**For Homebrew PostgreSQL:**
```bash
# Add to your ~/.zshrc (or ~/.bash_profile)
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify
psql --version
```

**Or if using Postgres.app:**
```bash
sudo mkdir -p /etc/paths.d
echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
```

## Step 2: Start PostgreSQL Service

**If using Homebrew:**
```bash
brew services start postgresql@17
# or
brew services start postgresql
```

**If using Postgres.app:**
- Just open the Postgres.app application

**Verify it's running:**
```bash
pg_isready
# Should output: /tmp:5432 - accepting connections
```

## Step 3: Install npm Dependencies

```bash
npm install
```

## Step 4: Run Database Setup

I've created a setup script. Run:

```bash
bash scripts/setup_database.sh
```

This will:
1. Find psql
2. Ask for database credentials
3. Test connection
4. Create the database
5. Create .env file
6. Run migrations

## Step 5: Verify Setup

```bash
npm run check
```

## Alternative: Manual Setup

If the script doesn't work, do it manually:

```bash
# 1. Create database
createdb pm_intelligence

# 2. Create .env file
cat > .env << EOF
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pm_intelligence
DB_USER=$(whoami)
DB_PASSWORD=
PORT=3000
API_HOST=0.0.0.0
ENABLE_RBAC=false
EOF

# 3. Run migrations
npm run migrate

# 4. Verify
npm run check
```

## Troubleshooting

### "psql: command not found"
- Add PostgreSQL to PATH (see Step 1)
- Or use full path: `/opt/homebrew/opt/postgresql@17/bin/psql`

### "Connection refused"
- Start PostgreSQL service (see Step 2)
- Check if running: `pg_isready`

### "Database already exists"
- That's OK! The setup will continue

### "Permission denied"
- Try with your macOS username instead of 'postgres'
- Or create a user: `createuser -s $(whoami)`
