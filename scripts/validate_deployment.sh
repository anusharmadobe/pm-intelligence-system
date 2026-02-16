#!/bin/bash

###############################################################################
# Deployment Validation Script
#
# Validates that all services are healthy and system is ready
#
# Usage:
#   ./scripts/validate_deployment.sh
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
###############################################################################

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Check result tracking
check_result() {
    ((TOTAL_CHECKS++))
    if [ $1 -eq 0 ]; then
        echo -e "  ${GREEN}✓${NC} $2"
        ((PASSED_CHECKS++))
        return 0
    else
        echo -e "  ${RED}✗${NC} $2"
        ((FAILED_CHECKS++))
        return 1
    fi
}

echo ""
echo "=========================================="
echo "  PM Intelligence System"
echo "  Deployment Validation"
echo "=========================================="
echo "Started: $(date)"
echo ""

# Load environment
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo -e "${RED}✗ .env file not found${NC}"
    exit 1
fi

echo -e "${BLUE}[1/7] Checking Docker Services...${NC}"
echo "=========================================="

# Check PostgreSQL
if docker compose ps | grep -q "pm_intel_postgres.*Up"; then
    check_result 0 "PostgreSQL container running"

    # Test connection
    if docker compose exec -T postgres pg_isready -U "$DB_USER" > /dev/null 2>&1; then
        check_result 0 "PostgreSQL accepting connections"
    else
        check_result 1 "PostgreSQL not accepting connections"
    fi
else
    check_result 1 "PostgreSQL container not running"
fi

# Check Neo4j
if docker compose ps | grep -q "pm_intel_neo4j.*Up"; then
    check_result 0 "Neo4j container running"

    # Test connection (simplified check)
    if curl -s http://localhost:7474 > /dev/null 2>&1; then
        check_result 0 "Neo4j HTTP interface accessible"
    else
        check_result 1 "Neo4j HTTP interface not accessible"
    fi
else
    check_result 1 "Neo4j container not running"
fi

# Check Redis
if docker compose ps | grep -q "pm_intel_redis.*Up"; then
    check_result 0 "Redis container running"

    # Test connection
    if docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" ping > /dev/null 2>&1; then
        check_result 0 "Redis accepting connections"
    else
        check_result 1 "Redis not accepting connections"
    fi
else
    check_result 1 "Redis container not running"
fi

echo ""
echo -e "${BLUE}[2/7] Checking Node.js Application...${NC}"
echo "=========================================="

# Check if application is running
if pgrep -f "ts-node.*index.ts" > /dev/null || pgrep -f "node.*dist/index.js" > /dev/null; then
    check_result 0 "Application process running"
else
    check_result 1 "Application process not running"
fi

# Check API health endpoint
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    check_result 0 "API server responding (port 3000)"

    # Parse health check response
    HEALTH_JSON=$(curl -s http://localhost:3000/health)

    # Check PostgreSQL health
    PG_STATUS=$(echo "$HEALTH_JSON" | grep -o '"postgresql":"[^"]*"' | cut -d'"' -f4)
    if [ "$PG_STATUS" = "healthy" ]; then
        check_result 0 "PostgreSQL health: healthy"
    else
        check_result 1 "PostgreSQL health: $PG_STATUS"
    fi

    # Check Neo4j health
    NEO4J_STATUS=$(echo "$HEALTH_JSON" | grep -o '"neo4j":"[^"]*"' | cut -d'"' -f4)
    if [ "$NEO4J_STATUS" = "healthy" ]; then
        check_result 0 "Neo4j health: healthy"
    else
        check_result 1 "Neo4j health: $NEO4J_STATUS"
    fi

    # Check Redis health
    REDIS_STATUS=$(echo "$HEALTH_JSON" | grep -o '"redis":"[^"]*"' | cut -d'"' -f4)
    if [ "$REDIS_STATUS" = "healthy" ]; then
        check_result 0 "Redis health: healthy"
    else
        check_result 1 "Redis health: $REDIS_STATUS"
    fi
else
    check_result 1 "API server not responding"
fi

# Check MCP server
if curl -s http://localhost:3001 > /dev/null 2>&1; then
    check_result 0 "MCP server responding (port 3001)"
else
    check_result 1 "MCP server not responding"
fi

echo ""
echo -e "${BLUE}[3/7] Checking Database Schema...${NC}"
echo "=========================================="

# Check if migrations have run
MIGRATION_CHECK=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "0")

if [ "$MIGRATION_CHECK" -gt 10 ]; then
    check_result 0 "Database schema initialized ($MIGRATION_CHECK tables)"
else
    check_result 1 "Database schema not properly initialized"
fi

# Check for pgvector extension
PGVECTOR_CHECK=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM pg_extension WHERE extname='vector'" 2>/dev/null || echo "0")

if [ "$PGVECTOR_CHECK" -eq 1 ]; then
    check_result 0 "pgvector extension installed"
else
    check_result 1 "pgvector extension not installed"
fi

echo ""
echo -e "${BLUE}[4/7] Checking Environment Configuration...${NC}"
echo "=========================================="

# Check required environment variables
REQUIRED_VARS=(
    "AZURE_OPENAI_ENDPOINT"
    "AZURE_OPENAI_KEY"
    "AZURE_OPENAI_CHAT_DEPLOYMENT"
    "AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT"
    "DB_HOST"
    "DB_NAME"
    "DB_USER"
    "NEO4J_URI"
    "REDIS_URL"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -n "${!var}" ]; then
        check_result 0 "$var is set"
    else
        check_result 1 "$var is not set"
    fi
done

echo ""
echo -e "${BLUE}[5/7] Checking Disk Space...${NC}"
echo "=========================================="

# Check available disk space (require at least 1GB)
AVAILABLE_SPACE=$(df . | tail -1 | awk '{print $4}')
AVAILABLE_GB=$((AVAILABLE_SPACE / 1024 / 1024))

if [ $AVAILABLE_GB -ge 1 ]; then
    check_result 0 "Sufficient disk space (${AVAILABLE_GB}GB available)"
else
    check_result 1 "Low disk space (${AVAILABLE_GB}GB available)"
fi

echo ""
echo -e "${BLUE}[6/7] Checking Network Connectivity...${NC}"
echo "=========================================="

# Check Azure OpenAI connectivity
if curl -s --max-time 5 "$AZURE_OPENAI_ENDPOINT" > /dev/null 2>&1; then
    check_result 0 "Azure OpenAI endpoint reachable"
else
    check_result 1 "Azure OpenAI endpoint not reachable"
fi

# Check Slack API connectivity (if token is set)
if [ -n "$SLACK_BOT_TOKEN" ]; then
    if curl -s --max-time 5 https://slack.com/api/api.test > /dev/null 2>&1; then
        check_result 0 "Slack API reachable"
    else
        check_result 1 "Slack API not reachable"
    fi
else
    echo -e "  ${YELLOW}⊝${NC} Slack token not configured (skipped)"
fi

echo ""
echo -e "${BLUE}[7/7] Checking Log Files...${NC}"
echo "=========================================="

# Check if log directory exists
if [ -d "data/logs" ]; then
    check_result 0 "Log directory exists"

    # Check for recent logs
    RECENT_LOGS=$(find data/logs -name "*.log" -mtime -1 | wc -l)
    if [ $RECENT_LOGS -gt 0 ]; then
        check_result 0 "Recent log files found ($RECENT_LOGS files)"
    else
        echo -e "  ${YELLOW}⊝${NC} No recent log files (may be first run)"
    fi
else
    check_result 1 "Log directory not found"
fi

# Summary
echo ""
echo "=========================================="
echo "  Validation Summary"
echo "=========================================="
echo -e "Total Checks: ${TOTAL_CHECKS}"
echo -e "Passed:       ${GREEN}${PASSED_CHECKS}${NC}"
echo -e "Failed:       ${RED}${FAILED_CHECKS}${NC}"
echo ""

if [ $FAILED_CHECKS -eq 0 ]; then
    echo -e "${GREEN}✓ All validation checks passed${NC}"
    echo -e "${GREEN}✓ System is ready for operation${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ $FAILED_CHECKS check(s) failed${NC}"
    echo -e "${YELLOW}⚠ Please address the failed checks before proceeding${NC}"
    echo ""
    exit 1
fi
