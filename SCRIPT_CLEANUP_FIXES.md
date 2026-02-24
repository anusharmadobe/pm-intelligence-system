# Script DB Pool Cleanup Fixes

## Issue
Multiple scripts use `getDbPool()` but never call `closeDbPool()`, leaving connections open and causing odd behavior when run repeatedly.

## Affected Scripts
1. scripts/llm_extract_slack.ts
2. scripts/llm_extract_sample.ts
3. scripts/monitor_pipeline_status.ts
4. scripts/check_slos.ts
5. scripts/backfill_v1_entities.ts
6. scripts/check_setup.ts

## Fix Pattern

Each script needs to:
1. Import `closeDbPool` from `../backend/db/connection`
2. Wrap main logic in try-catch-finally
3. Call `closeDbPool()` in finally block
4. Set process.exitCode on error instead of process.exit()

## Fix Template

```typescript
import { getDbPool, closeDbPool } from '../backend/db/connection';

async function main() {
  try {
    // ... script logic ...
  } catch (error: any) {
    console.error('Script failed:', error.message);
    process.exitCode = 1;
  } finally {
    // CRITICAL: Always close DB pool
    await closeDbPool();
  }
}

main();
```

## Implementation

Apply this pattern to all 6 scripts. The key changes are:
- Add `closeDbPool` to imports
- Wrap entire main function in try-catch-finally
- Call `closeDbPool()` in finally block
- Use `process.exitCode = 1` instead of `process.exit(1)` in catch block

## Testing

After fixes, verify no connections leak:
```bash
# Before running script
psql -c "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();"

# Run script
npm run check

# After script completes
psql -c "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();"
# Connection count should be back to baseline
```
