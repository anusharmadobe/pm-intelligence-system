#!/bin/bash

###############################################################################
# Database Backup Script
#
# Creates compressed backups of PostgreSQL database
# Retention: 30 days rolling
#
# Usage:
#   ./scripts/backup_database.sh
#
# Cron setup (daily at 2 AM):
#   0 2 * * * cd /path/to/PM_cursor_system && ./scripts/backup_database.sh >> logs/backup.log 2>&1
###############################################################################

set -e  # Exit on error

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Configuration
BACKUP_DIR="data/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="pg_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=30

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "=========================================="
echo "PostgreSQL Database Backup"
echo "=========================================="
echo "Timestamp: $(date)"
echo ""

# Create backup directory if it doesn't exist
if [ ! -d "$BACKUP_DIR" ]; then
    echo "Creating backup directory: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
fi

# Check if required variables are set
if [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ] || [ -z "$DB_USER" ]; then
    echo -e "${RED}Error: Required database variables not set in .env${NC}"
    echo "Required: DB_HOST, DB_NAME, DB_USER"
    exit 1
fi

# Check if PostgreSQL is accessible
if ! command -v pg_dump &> /dev/null; then
    echo -e "${YELLOW}Warning: pg_dump not found in PATH${NC}"
    echo "Attempting to use Docker container..."

    # Try using Docker
    if docker compose ps | grep -q "pm_intel_postgres"; then
        echo "Using PostgreSQL container for backup..."
        docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"
    else
        echo -e "${RED}Error: PostgreSQL container not running and pg_dump not available${NC}"
        exit 1
    fi
else
    # Use local pg_dump
    echo "Creating backup..."
    PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"
fi

# Check if backup was successful
if [ -f "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
    BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}✓ Backup created successfully${NC}"
    echo "  File: ${BACKUP_DIR}/${BACKUP_FILE}"
    echo "  Size: ${BACKUP_SIZE}"
else
    echo -e "${RED}✗ Backup failed${NC}"
    exit 1
fi

# Clean up old backups (retention policy)
echo ""
echo "Cleaning up old backups (retention: ${RETENTION_DAYS} days)..."
DELETED_COUNT=0

while IFS= read -r old_backup; do
    if [ -n "$old_backup" ]; then
        echo "  Deleting: $old_backup"
        rm "$old_backup"
        ((DELETED_COUNT++))
    fi
done < <(find "$BACKUP_DIR" -name "pg_*.sql.gz" -type f -mtime +$RETENTION_DAYS)

if [ $DELETED_COUNT -gt 0 ]; then
    echo -e "${GREEN}✓ Deleted $DELETED_COUNT old backup(s)${NC}"
else
    echo "  No old backups to delete"
fi

# Display backup summary
echo ""
echo "=========================================="
echo "Backup Summary"
echo "=========================================="
echo "Total backups: $(ls -1 ${BACKUP_DIR}/pg_*.sql.gz 2>/dev/null | wc -l)"
echo "Disk usage: $(du -sh ${BACKUP_DIR} | cut -f1)"
echo ""

# List recent backups
echo "Recent backups:"
ls -lh "${BACKUP_DIR}"/pg_*.sql.gz 2>/dev/null | tail -n 5 || echo "  No backups found"

echo ""
echo -e "${GREEN}✓ Backup complete${NC}"
echo ""
