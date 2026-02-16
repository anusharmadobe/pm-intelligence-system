#!/bin/bash

###############################################################################
# System Status Check Script
# 
# Shows current data counts in all databases and data sources
###############################################################################

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    PM Intelligence System - Status Check${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

DB_NAME=${DB_NAME:-pm_intelligence}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}

###############################################################################
# Data Source Files
###############################################################################
echo -e "${BLUE}📁 Data Source Files:${NC}"
echo ""

# Community Forum
if [ -f "data/raw/community_forums/aem_forms_full_dump.json" ]; then
    FORUM_SIZE=$(du -h data/raw/community_forums/aem_forms_full_dump.json | cut -f1)
    FORUM_COUNT=$(jq 'length' data/raw/community_forums/aem_forms_full_dump.json 2>/dev/null || echo "N/A")
    echo -e "  Community Forum Data:"
    echo "    Location: data/raw/community_forums/aem_forms_full_dump.json"
    echo "    Size: $FORUM_SIZE"
    echo "    Thread Count: $FORUM_COUNT"
else
    echo -e "  ${YELLOW}⚠️  Community forum data not found${NC}"
fi

echo ""

# Slack
if [ -f "data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json" ]; then
    SLACK_SIZE=$(du -h data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json | cut -f1)
    SLACK_COUNT=$(jq 'length' data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json 2>/dev/null || echo "N/A")
    echo -e "  Slack Data:"
    echo "    Location: data/raw/slack/C04D195JVGS/customer_engagement_C04D195JVGS_complete.json"
    echo "    Size: $SLACK_SIZE"
    echo "    Channel Objects: $SLACK_COUNT"
else
    echo -e "  ${YELLOW}⚠️  Slack data not found${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

###############################################################################
# PostgreSQL Database
###############################################################################
echo -e "${BLUE}🗄️  PostgreSQL Database (${DB_NAME}):${NC}"
echo ""

if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1" > /dev/null 2>&1; then
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t <<SQL
SELECT 
  '  Signals: ' || COALESCE((SELECT COUNT(*)::text FROM signals), '0') ||
  '\n  Signal Extractions: ' || COALESCE((SELECT COUNT(*)::text FROM signal_extractions), '0') ||
  '\n  Entity Registry: ' || COALESCE((SELECT COUNT(*)::text FROM entity_registry), '0') ||
  '\n  Entity Resolution Log: ' || COALESCE((SELECT COUNT(*)::text FROM entity_resolution_log), '0') ||
  '\n  Opportunities: ' || COALESCE((SELECT COUNT(*)::text FROM opportunities), '0') ||
  '\n  Neo4j Sync Backlog: ' || COALESCE((SELECT COUNT(*)::text FROM neo4j_sync_backlog WHERE status = 'pending'), '0') || ' pending';
SQL
else
    echo -e "  ${YELLOW}⚠️  Cannot connect to PostgreSQL${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

###############################################################################
# Neo4j Graph Database
###############################################################################
echo -e "${BLUE}🕸️  Neo4j Graph Database:${NC}"
echo ""

NEO4J_URI=${NEO4J_URI:-bolt://localhost:7687}
NEO4J_USER=${NEO4J_USER:-neo4j}
NEO4J_PASSWORD=${NEO4J_PASSWORD:-password}

if command -v cypher-shell &> /dev/null; then
    if cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD "RETURN 1" > /dev/null 2>&1; then
        NODE_COUNT=$(cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD --format plain "MATCH (n) RETURN count(n) as count" 2>/dev/null | tail -n 1 || echo "0")
        REL_COUNT=$(cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD --format plain "MATCH ()-[r]->() RETURN count(r) as count" 2>/dev/null | tail -n 1 || echo "0")
        echo "  Total Nodes: $NODE_COUNT"
        echo "  Total Relationships: $REL_COUNT"
    else
        echo -e "  ${YELLOW}⚠️  Cannot connect to Neo4j${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠️  cypher-shell not found${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

###############################################################################
# Redis Cache
###############################################################################
echo -e "${BLUE}💾 Redis Cache:${NC}"
echo ""

REDIS_URL=${REDIS_URL:-redis://localhost:6379}
REDIS_HOST=$(echo $REDIS_URL | sed -E 's|redis://([^:]+):.*|\1|')
REDIS_PORT=$(echo $REDIS_URL | sed -E 's|redis://[^:]+:([0-9]+).*|\1|')

if command -v redis-cli &> /dev/null; then
    if redis-cli -h $REDIS_HOST -p $REDIS_PORT PING > /dev/null 2>&1; then
        KEY_COUNT=$(redis-cli -h $REDIS_HOST -p $REDIS_PORT DBSIZE 2>/dev/null | awk '{print $2}')
        echo "  Total Keys: $KEY_COUNT"
    else
        echo -e "  ${YELLOW}⚠️  Cannot connect to Redis${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠️  redis-cli not found${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Summary
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM signals" > /dev/null 2>&1
SIGNAL_COUNT=$?

if [ $SIGNAL_COUNT -eq 0 ]; then
    SIGNALS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM signals" | xargs)
    if [ "$SIGNALS" = "0" ]; then
        echo -e "${GREEN}✓ System is CLEAN and ready for testing${NC}"
    else
        echo -e "${YELLOW}⚠️  System contains existing data ($SIGNALS signals)${NC}"
        echo -e "   Run ${BLUE}./scripts/reset_system.sh${NC} to clean before testing"
    fi
else
    echo -e "${YELLOW}⚠️  Cannot determine system state${NC}"
fi

echo ""
