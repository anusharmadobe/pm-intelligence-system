# Forum Scraper

Dockerized Selenium scraper for forum thread dumps.

## Inputs

- `--forum`: forum key from `config/forum_sources.json`
- `--config`: config path (default `/app/config/forum_sources.json` in container)
- `--output`: output JSON path
- `--max-pages`: optional load-more/page limit
- `--test`: optional thread URL limit for smoke runs
- `--since`: optional date filter (`YYYY-MM-DD`)
- `--delay`: optional per-page delay in seconds

## Output

Writes `ForumThread[]` JSON compatible with `scripts/ingest_community_forums_v2.ts`.

## Typical run

Use the project orchestrator:

`npm run scrape:forums -- --forum aem-forms --test 20`
