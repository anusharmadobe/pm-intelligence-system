#!/bin/bash
# Quick setup script - run this after creating the PostgreSQL user

echo "🚀 PM Intelligence System - Quick Setup"
echo "========================================"
echo ""
echo "This script will set up the database using:"
echo "  User: anusharm"
echo "  Password: pm_intelligence"
echo "  Database: pm_intelligence"
echo ""
read -p "Press Enter to continue (or Ctrl+C to cancel)..."

cd /Users/anusharm/learn/PM_cursor_system
DB_USER=anusharm DB_PASSWORD=pm_intelligence npm run setup-db-auto

echo ""
echo "✅ Setup complete! Run 'npm run check' to verify."
