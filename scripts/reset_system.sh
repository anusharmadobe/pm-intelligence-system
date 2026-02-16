#!/bin/bash

###############################################################################
# System Reset Script for PM Intelligence System
# 
# This script resets all databases, caches, and output files to prepare
# for fresh end-to-end testing.
#
# Usage: ./scripts/reset_system.sh [--force]
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if running with --force flag
FORCE=false
if [ "$1" = "--force" ]; then
    FORCE=true
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    PM Intelligence System - Complete Reset${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Warning prompt
if [ "$FORCE" = false ]; then
    echo -e "${RED}⚠️  WARNING: This will DELETE ALL DATA in:${NC}"
    echo "   - PostgreSQL database (pm_intelligence)"
    echo "   - Neo4j graph database"
    echo "   - Redis cache"
    echo "   - All logs and output files"
    echo ""
    echo -e "${YELLOW}Source data in data/raw/ will NOT be deleted.${NC}"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo -e "${YELLOW}Reset cancelled.${NC}"
        exit 0
    fi
fi

echo -e "${GREEN}Starting system reset...${NC}"
echo ""

###############################################################################
# Step 1: Reset PostgreSQL Database
###############################################################################
echo -e "${BLUE}[1/6] Resetting PostgreSQL database...${NC}"

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

DB_NAME=${DB_NAME:-pm_intelligence}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}

# Drop and recreate database
echo "   Dropping database: $DB_NAME"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "DROP DATABASE IF EXISTS $DB_NAME;" postgres 2>/dev/null || echo "   (Database may not exist, continuing...)"

echo "   Creating fresh database: $DB_NAME"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c "CREATE DATABASE $DB_NAME;" postgres

echo "   Installing pgvector extension"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || echo "   (pgvector may not be available, continuing...)"

echo -e "${GREEN}   ✓ PostgreSQL database reset complete${NC}"
echo ""

###############################################################################
# Step 2: Run Database Migrations
###############################################################################
echo -e "${BLUE}[2/6] Running database migrations...${NC}"

npm run migrate

echo -e "${GREEN}   ✓ Database migrations complete${NC}"
echo ""

###############################################################################
# Step 3: Reset Neo4j Graph Database
###############################################################################
echo -e "${BLUE}[3/6] Resetting Neo4j graph database...${NC}"

NEO4J_URI=${NEO4J_URI:-bolt://localhost:7687}
NEO4J_USER=${NEO4J_USER:-neo4j}
NEO4J_PASSWORD=${NEO4J_PASSWORD:-password}

# Check if cypher-shell is available
if command -v cypher-shell &> /dev/null; then
    echo "   Deleting all nodes and relationships"
    cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD "MATCH (n) DETACH DELETE n" 2>/dev/null || echo "   (Neo4j may not be running, continuing...)"
    echo -e "${GREEN}   ✓ Neo4j database reset complete${NC}"
else
    echo -e "${YELLOW}   ⚠️  cypher-shell not found. Please manually reset Neo4j:${NC}"
    echo "      MATCH (n) DETACH DELETE n"
fi
echo ""

###############################################################################
# Step 4: Reset Redis Cache
###############################################################################
echo -e "${BLUE}[4/6] Resetting Redis cache...${NC}"

REDIS_URL=${REDIS_URL:-redis://localhost:6379}

# Extract host and port from Redis URL
REDIS_HOST=$(echo $REDIS_URL | sed -E 's|redis://([^:]+):.*|\1|')
REDIS_PORT=$(echo $REDIS_URL | sed -E 's|redis://[^:]+:([0-9]+).*|\1|')

if command -v redis-cli &> /dev/null; then
    echo "   Flushing all Redis keys"
    redis-cli -h $REDIS_HOST -p $REDIS_PORT FLUSHALL 2>/dev/null || echo "   (Redis may not be running, continuing...)"
    echo -e "${GREEN}   ✓ Redis cache reset complete${NC}"
else
    echo -e "${YELLOW}   ⚠️  redis-cli not found. Please manually reset Redis:${NC}"
    echo "      redis-cli FLUSHALL"
fi
echo ""

###############################################################################
# Step 5: Clean Output Files and Logs
###############################################################################
echo -e "${BLUE}[5/6] Cleaning output files and logs...${NC}"

# Clean output directory
if [ -d "output" ]; then
    echo "   Removing output files"
    rm -rf output/*
    echo "   Created fresh output directory"
    mkdir -p output
fi

# Clean logs
if [ -d "logs" ]; then
    echo "   Archiving old logs"
    if [ "$(ls -A logs 2>/dev/null)" ]; then
        mkdir -p logs/archive
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        mv logs/*.log logs/archive/ 2>/dev/null || true
        echo "   Logs archived to logs/archive/"
    fi
fi

# Clean intermediate ingestion progress files
if [ -d "data/intermediate" ]; then
    echo "   Cleaning ingestion checkpoints"
    rm -f data/intermediate/ingestion_progress.json
    rm -f data/intermediate/thread_replies_progress.json
    rm -f data/intermediate/thread_timestamps.json
fi

echo -e "${GREEN}   ✓ Output files and logs cleaned${NC}"
echo ""

###############################################################################
# Step 6: Verify System Health
###############################################################################
echo -e "${BLUE}[6/6] Verifying system health...${NC}"

# Check PostgreSQL
echo -n "   PostgreSQL: "
if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Connected${NC}"
else
    echo -e "${RED}✗ Not accessible${NC}"
fi

# Check Neo4j
echo -n "   Neo4j: "
if command -v cypher-shell &> /dev/null; then
    if cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD "RETURN 1" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Connected${NC}"
    else
        echo -e "${RED}✗ Not accessible${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Cannot verify (cypher-shell not found)${NC}"
fi

# Check Redis
echo -n "   Redis: "
if command -v redis-cli &> /dev/null; then
    if redis-cli -h $REDIS_HOST -p $REDIS_PORT PING > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Connected${NC}"
    else
        echo -e "${RED}✗ Not accessible${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Cannot verify (redis-cli not found)${NC}"
fi

echo ""

###############################################################################
# Summary
###############################################################################
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ System Reset Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "The system is now ready for end-to-end testing."
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Review pre-flight checklist: docs/v2/PREFLIGHT_CHECKLIST.md"
echo "  2. Run pre-flight validation: npm test -- entity_resolution_accuracy.test.ts"
echo "  3. Start end-to-end testing: docs/v2/FINAL_TESTING_GUIDE.md"
echo ""
echo -e "${BLUE}Data Source Locations:${NC}"
echo "  - Community Forums: data/raw/community_forums/aem_forms_full_dump.json (3,028 threads)"
echo "  - Slack Messages: data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json"
echo ""
