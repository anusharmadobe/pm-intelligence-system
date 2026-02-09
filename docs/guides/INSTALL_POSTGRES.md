# Installing PostgreSQL on macOS

## Option 1: Homebrew (Recommended)

Run these commands in your terminal:

```bash
# Install PostgreSQL
brew install postgresql@15

# Start PostgreSQL service
brew services start postgresql@15

# Add to PATH (add this to your ~/.zshrc or ~/.bash_profile)
echo 'export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify installation
psql --version
```

## Option 2: Postgres.app (GUI)

1. Download from: https://postgresapp.com/
2. Install and open the app
3. Click "Initialize" to create a new server
4. The `psql` command will be available in your PATH

## Option 3: Docker (If you prefer containers)

```bash
# Run PostgreSQL in Docker
docker run --name pm-intelligence-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=pm_intelligence \
  -p 5432:5432 \
  -d postgres:15

# Connect to it
docker exec -it pm-intelligence-db psql -U postgres -d pm_intelligence
```

## After Installation

Once PostgreSQL is installed, come back and we'll:
1. Create the database
2. Run migrations
3. Set up the project

Run this to verify:
```bash
psql --version
createdb --version
```

Then let me know and we'll continue with the setup!
