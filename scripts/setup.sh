#!/bin/bash

# PM Intelligence System Setup Script

set -e

echo "🚀 PM Intelligence System Setup"
echo "================================"
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed. Please install PostgreSQL first."
    exit 1
fi

echo "✓ PostgreSQL found"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✓ Node.js found: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✓ npm found: $(npm --version)"
echo ""

# Step 1: Install dependencies
echo "📦 Step 1: Installing dependencies..."
npm install
echo "✓ Dependencies installed"
echo ""

# Step 2: Database setup
echo "🗄️  Step 2: Database Setup"
echo ""

# Get database credentials
read -p "Database host [localhost]: " DB_HOST
DB_HOST=${DB_HOST:-localhost}

read -p "Database port [5432]: " DB_PORT
DB_PORT=${DB_PORT:-5432}

read -p "Database name [pm_intelligence]: " DB_NAME
DB_NAME=${DB_NAME:-pm_intelligence}

read -p "Database user [postgres]: " DB_USER
DB_USER=${DB_USER:-postgres}

read -s -p "Database password: " DB_PASSWORD
echo ""

# Export environment variables
export DB_HOST=$DB_HOST
export DB_PORT=$DB_PORT
export DB_NAME=$DB_NAME
export DB_USER=$DB_USER
export DB_PASSWORD=$DB_PASSWORD

echo ""
echo "Creating database if it doesn't exist..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || echo "Database already exists or error occurred (this is OK)"
echo ""

# Step 3: Run migrations
echo "📊 Step 3: Running database migrations..."
npm run migrate
echo "✓ Migrations completed"
echo ""

# Step 4: Create .env file
echo "⚙️  Step 4: Creating .env file..."
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

# Step 5: Build project
echo "🔨 Step 5: Building project..."
npm run build
echo "✓ Build completed"
echo ""

# Step 6: Optional - Seed sample data
read -p "Would you like to seed sample data? (y/n) [n]: " SEED_DATA
if [[ $SEED_DATA == "y" || $SEED_DATA == "Y" ]]; then
    echo "🌱 Seeding sample data..."
    npm run seed
    echo "✓ Sample data seeded"
fi
echo ""

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start the API server: npm start"
echo "2. Configure integrations (see SETUP_INTEGRATIONS.md)"
echo "3. Use Cursor extension commands in your IDE"
echo ""
