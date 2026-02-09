#!/bin/bash

# Script to create PostgreSQL user via psql command line

set -e

NEW_USER="anusharm"
NEW_PASSWORD="pm_intelligence"
DB_NAME="pm_intelligence"

echo "🔐 Creating PostgreSQL User"
echo "==========================="
echo ""

# Find psql
PSQL_PATH=""
PATHS_TO_CHECK=(
    "/opt/homebrew/opt/postgresql@17/bin/psql"
    "/opt/homebrew/opt/postgresql/bin/psql"
    "/usr/local/opt/postgresql@17/bin/psql"
    "/usr/local/opt/postgresql/bin/psql"
    "/Applications/Postgres.app/Contents/Versions/latest/bin/psql"
    "/usr/local/bin/psql"
    "psql"
)

for path in "${PATHS_TO_CHECK[@]}"; do
    if command -v "$path" &> /dev/null || [ -f "$path" ]; then
        if "$path" --version &> /dev/null; then
            PSQL_PATH="$path"
            break
        fi
    fi
done

if [ -z "$PSQL_PATH" ]; then
    echo "❌ psql not found"
    echo "Please ensure PostgreSQL is installed and psql is in your PATH"
    exit 1
fi

echo "✓ Found psql at: $PSQL_PATH"
echo ""

# Try to connect and create user
echo "Attempting to create user '$NEW_USER'..."

# Try as postgres user first (may require password)
if "$PSQL_PATH" -U postgres -d postgres -c "SELECT 1" &> /dev/null; then
    echo "✓ Connected as postgres user"
    ADMIN_USER="postgres"
elif "$PSQL_PATH" -U $(whoami) -d postgres -c "SELECT 1" &> /dev/null; then
    echo "✓ Connected as $(whoami) user"
    ADMIN_USER=$(whoami)
else
    echo "⚠️  Cannot connect automatically"
    echo ""
    echo "Please run these commands manually:"
    echo ""
    echo "  $PSQL_PATH -U postgres -d postgres"
    echo ""
    echo "Then run:"
    echo "  CREATE USER $NEW_USER WITH PASSWORD '$NEW_PASSWORD' CREATEDB SUPERUSER;"
    echo "  \\q"
    echo ""
    echo "Or if that doesn't work, try:"
    echo "  $PSQL_PATH -U $(whoami) -d postgres"
    echo ""
    exit 1
fi

# Create or update user
echo ""
echo "Creating/updating user '$NEW_USER'..."

# Check if user exists
USER_EXISTS=$("$PSQL_PATH" -U "$ADMIN_USER" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$NEW_USER'" 2>/dev/null || echo "")

if [ -n "$USER_EXISTS" ]; then
    echo "⚠️  User already exists, updating..."
    "$PSQL_PATH" -U "$ADMIN_USER" -d postgres -c "ALTER USER $NEW_USER WITH PASSWORD '$NEW_PASSWORD' CREATEDB SUPERUSER;" 2>&1
    echo "✓ Password and privileges updated"
else
    "$PSQL_PATH" -U "$ADMIN_USER" -d postgres -c "CREATE USER $NEW_USER WITH PASSWORD '$NEW_PASSWORD' CREATEDB SUPERUSER;" 2>&1
    echo "✓ User created with privileges"
fi

echo ""
echo "✅ User setup complete!"
echo "   Username: $NEW_USER"
echo "   Password: $NEW_PASSWORD"
echo "   Privileges: CREATEDB, SUPERUSER"
echo ""
