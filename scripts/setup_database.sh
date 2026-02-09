#!/bin/bash

# Database Setup Script for PM Intelligence System

set -e

echo "🗄️  PM Intelligence Database Setup"
echo "===================================="
echo ""

# Find psql
PSQL_PATH=""
if command -v psql &> /dev/null; then
    PSQL_PATH=$(which psql)
elif [ -f "/opt/homebrew/opt/postgresql@17/bin/psql" ]; then
    PSQL_PATH="/opt/homebrew/opt/postgresql@17/bin/psql"
elif [ -f "/opt/homebrew/opt/postgresql/bin/psql" ]; then
    PSQL_PATH="/opt/homebrew/opt/postgresql/bin/psql"
elif [ -f "/usr/local/bin/psql" ]; then
    PSQL_PATH="/usr/local/bin/psql"
else
    echo "❌ psql not found. Please ensure PostgreSQL is installed and in your PATH."
    echo ""
    echo "Try adding PostgreSQL to your PATH:"
    echo "  export PATH=\"/opt/homebrew/opt/postgresql@17/bin:\$PATH\""
    echo ""
    echo "Or if using Postgres.app:"
    echo "  sudo mkdir -p /etc/paths.d &&"
    echo "  echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp"
    exit 1
fi

echo "✓ Found psql at: $PSQL_PATH"
echo ""

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
if [ -z "$DB_PASSWORD" ]; then
    PGPASSWORD="" $PSQL_PATH -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "SELECT 1;" > /dev/null 2>&1
else
    PGPASSWORD=$DB_PASSWORD $PSQL_PATH -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "SELECT 1;" > /dev/null 2>&1
fi

if [ $? -eq 0 ]; then
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
if [ -z "$DB_PASSWORD" ]; then
    PGPASSWORD="" $PSQL_PATH -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || echo "  Database already exists (OK)"
else
    PGPASSWORD=$DB_PASSWORD $PSQL_PATH -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || echo "  Database already exists (OK)"
fi

echo "✓ Database '$DB_NAME' ready"
echo ""

# Create .env file
echo "Creating .env file..."
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

# Run migrations
echo "Running database migrations..."
npm run migrate

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Next steps:"
echo "1. Verify setup: npm run check"
echo "2. Seed sample data (optional): npm run seed"
echo "3. Start API server: npm start"
echo ""
