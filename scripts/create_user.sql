-- SQL script to create PostgreSQL user for PM Intelligence System
-- Run this as PostgreSQL superuser (postgres)

-- Create user with password and privileges
CREATE USER anusharm WITH PASSWORD 'pm_intelligence' CREATEDB SUPERUSER;

-- Verify user was created
SELECT rolname, rolcreatedb, rolsuper FROM pg_roles WHERE rolname = 'anusharm';

-- If user already exists, you can update it with:
-- ALTER USER anusharm WITH PASSWORD 'pm_intelligence' CREATEDB SUPERUSER;
