#!/bin/bash

# Complete Database Setup Script
# This script handles PostgreSQL path detection and setup

set -e

echo "🚀 PM Intelligence System - Complete Setup"
echo "=========================================="
echo ""

# Step 1: Find PostgreSQL
echo "Step 1: Finding PostgreSQL installation..."

PSQL_PATH=""
CREATEDB_PATH=""

# Try common locations
PATHS_TO_CHECK=(
    "/opt/homebrew/opt/postgresql@17/bin/psql"
    "/opt/homebrew/opt/postgresql/bin/psql"
    "/usr/local/opt/postgresql@17/bin/psql"
    "/usr/local/opt/postgresql/bin/psql"
    "/Applications/Postgres.app/Contents/Versions/latest/bin/psql"
    "/Applications/Postgres.app/Contents/Versions/17/bin/psql"
    "/Applications/Postgres.app/Contents/Versions/16/bin/psql"
    "/Applications/Postgres.app/Contents/Versions/15/bin/psql"
    "/usr/local/bin/psql"
    "/usr/bin/psql"
)

for path in "${PATHS_TO_CHECK[@]}"; do
    if [ -f "$path" ]; then
        PSQL_PATH="$path"
        CREATEDB_PATH="${path%psql}createdb"
        echo "✓ Found PostgreSQL at: $PSQL_PATH"
        break
    fi
done

if [ -z "$PSQL_PATH" ]; then
    echo "❌ PostgreSQL not found in common locations"
    echo ""
    echo "Please install PostgreSQL:"
    echo "  Option 1: brew install postgresql@17"
    echo "  Option 2: Download Postgres.app from https://postgresapp.com/"
    echo ""
    echo "Or provide the full path to psql:"
    read -p "psql path: " PSQL_PATH
    CREATEDB_PATH="${PSQL_PATH%psql}createdb"
fi

# Verify psql works
if ! "$PSQL_PATH" --version > /dev/null 2>&1; then
    echo "❌ Cannot execute psql. Please check permissions."
    exit 1
fi

PSQL_VERSION=$("$PSQL_PATH" --version)
echo "  Version: $PSQL_VERSION"
echo ""

# Step 2: Check if PostgreSQL is running
echo "Step 2: Checking PostgreSQL service..."

# Try pg_isready if available
PG_ISREADY_PATH="${PSQL_PATH%psql}pg_isready"
if [ -f "$PG_ISREADY_PATH" ]; then
    if "$PG_ISREADY_PATH" > /dev/null 2>&1; then
        echo "✓ PostgreSQL is running"
    else
        echo "⚠️  PostgreSQL may not be running"
        echo "   Try: brew services start postgresql@17"
        echo "   Or open Postgres.app if using that"
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    echo "⚠️  Cannot verify PostgreSQL status (pg_isready not found)"
    echo "   Assuming PostgreSQL is running..."
fi
echo ""

# Step 3: Install npm dependencies
echo "Step 3: Installing npm dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
    echo "✓ npm dependencies installed"
else
    echo "✓ node_modules already exists (skipping)"
fi
echo ""

# Step 4: Database setup
echo "Step 4: Setting up database..."

# Get database credentials
read -p "Database host [localhost]: " DB_HOST
DB_HOST=${DB_HOST:-localhost}

read -p "Database port [5432]: " DB_PORT
DB_PORT=${DB_PORT:-5432}

read -p "Database name [pm_intelligence]: " DB_NAME
DB_NAME=${DB_NAME:-pm_intelligence}

read -p "Database user [$(whoami)]: " DB_USER
DB_USER=${DB_USER:-$(whoami)}

read -s -p "Database password (press Enter if no password): " DB_PASSWORD
echo ""

# Test connection
echo ""
echo "Testing database connection..."
export PGPASSWORD="$DB_PASSWORD"
if "$PSQL_PATH" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✓ Database connection successful"
else
    echo "❌ Database connection failed"
    echo "Please check:"
    echo "  1. PostgreSQL service is running"
    echo "  2. Database credentials are correct"
    echo "  3. User has permission to create databases"
    exit 1
fi

# Create database
echo ""
echo "Creating database '$DB_NAME'..."
if "$CREATEDB_PATH" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" 2>/dev/null; then
    echo "✓ Database created"
elif "$PSQL_PATH" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;" > /dev/null 2>&1; then
    echo "✓ Database created"
else
    echo "⚠️  Database may already exist (continuing...)"
fi
echo ""

# Create .env file
echo "Step 5: Creating .env file..."
cat > .env << EOF
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
PORT=3000
API_HOST=0.0.0.0
ENABLE_RBAC=false
EOF
echo "✓ .env file created"
echo ""

# Export for npm scripts
export DB_HOST=$DB_HOST
export DB_PORT=$DB_PORT
export DB_NAME=$DB_NAME
export DB_USER=$DB_USER
export DB_PASSWORD=$DB_PASSWORD

# Step 6: Run migrations
echo "Step 6: Running database migrations..."
npm run migrate
echo ""

# Step 7: Verify setup
echo "Step 7: Verifying setup..."
npm run check
echo ""

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Seed sample data (optional): npm run seed"
echo "2. Start API server: npm start"
echo "3. Test API: curl http://localhost:3000/health"
echo ""
