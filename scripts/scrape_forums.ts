#!/usr/bin/env ts-node
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

type ForumSourceConfig = {
  forums: Record<string, { enabled?: boolean; name?: string }>;
  defaults?: { output_dir?: string };
};

type CliOptions = {
  forum?: string;
  ingest: boolean;
  test?: number;
  since?: string;
  maxPages?: number;
  delay?: number;
  configPath: string;
  help: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    ingest: false,
    configPath: join(process.cwd(), 'config', 'forum_sources.json'),
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--forum') {
      opts.forum = argv[++i];
    } else if (arg.startsWith('--forum=')) {
      opts.forum = arg.split('=')[1];
    } else if (arg === '--ingest') {
      opts.ingest = true;
    } else if (arg === '--test') {
      opts.test = Number(argv[++i]);
    } else if (arg.startsWith('--test=')) {
      opts.test = Number(arg.split('=')[1]);
    } else if (arg === '--since') {
      opts.since = argv[++i];
    } else if (arg.startsWith('--since=')) {
      opts.since = arg.split('=')[1];
    } else if (arg === '--max-pages') {
      opts.maxPages = Number(argv[++i]);
    } else if (arg.startsWith('--max-pages=')) {
      opts.maxPages = Number(arg.split('=')[1]);
    } else if (arg === '--delay') {
      opts.delay = Number(argv[++i]);
    } else if (arg.startsWith('--delay=')) {
      opts.delay = Number(arg.split('=')[1]);
    } else if (arg === '--config') {
      opts.configPath = argv[++i];
    } else if (arg.startsWith('--config=')) {
      opts.configPath = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.test !== undefined && (!Number.isFinite(opts.test) || opts.test <= 0)) {
    throw new Error('--test must be a positive number');
  }
  if (opts.maxPages !== undefined && (!Number.isFinite(opts.maxPages) || opts.maxPages <= 0)) {
    throw new Error('--max-pages must be a positive number');
  }
  if (opts.delay !== undefined && (!Number.isFinite(opts.delay) || opts.delay < 0)) {
    throw new Error('--delay must be >= 0');
  }

  return opts;
}

function printUsage(): void {
  console.log(`
Forum scraper orchestrator

Usage:
  npm run scrape:forums
  npm run scrape:forums -- --forum aem-forms
  npm run scrape:forums -- --forum aem-forms --test 20
  npm run scrape:forums -- --forum aem-forms --since 2025-01-01
  npm run scrape:forums -- --forum aem-forms --ingest

Options:
  --forum <key>       Scrape a single forum key from config
  --ingest            Run npm run ingest-forums after scraping
  --test <n>          Limit thread URLs for smoke run
  --since <date>      Keep only threads on/after date (YYYY-MM-DD recommended)
  --max-pages <n>     Max load-more/page iterations in scraper
  --delay <seconds>   Delay between page loads
  --config <path>     Config path (default config/forum_sources.json)
  --help              Show this help
`);
}

function readForumConfig(path: string): ForumSourceConfig {
  if (!existsSync(path)) {
    throw new Error(`Forum config file not found: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as ForumSourceConfig;
  if (!raw.forums || typeof raw.forums !== 'object') {
    throw new Error(`Invalid forum config at ${path}: missing forums`);
  }
  return raw;
}

function buildForumList(config: ForumSourceConfig, forumArg?: string): string[] {
  const keys = Object.keys(config.forums);
  if (forumArg) {
    if (!config.forums[forumArg]) {
      throw new Error(`Unknown forum '${forumArg}'. Available: ${keys.join(', ')}`);
    }
    return [forumArg];
  }
  const enabled = keys.filter((k) => config.forums[k]?.enabled);
  if (enabled.length === 0) {
    throw new Error('No enabled forums found in config/forum_sources.json');
  }
  return enabled;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function runForumScrape(
  forum: string,
  opts: CliOptions,
  outputDir: string
): { outputFile: string; threadCount: number } {
  const outputFile = `${forum}_dump_${timestamp()}.json`;
  const outputContainerPath = `/app/output/${outputFile}`;

  const args: string[] = [
    'compose',
    '--profile',
    'scraper',
    'run',
    '--rm',
    'forum-scraper',
    'python',
    'forum_dump.py',
    '--forum',
    forum,
    '--config',
    '/app/config/forum_sources.json',
    '--output',
    outputContainerPath
  ];

  if (opts.maxPages !== undefined) {
    args.push('--max-pages', String(opts.maxPages));
  }
  if (opts.test !== undefined) {
    args.push('--test', String(opts.test));
  }
  if (opts.since) {
    args.push('--since', opts.since);
  }
  if (opts.delay !== undefined) {
    args.push('--delay', String(opts.delay));
  }

  console.log(`\n[forum-scraper] Starting ${forum}...`);
  console.log(`[forum-scraper] docker ${args.join(' ')}`);

  const proc = spawnSync('docker', args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env
  });

  if (proc.error) {
    throw new Error(`Failed running docker compose: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    throw new Error(`Scraper failed for forum '${forum}' with exit code ${proc.status}`);
  }

  const outputPath = join(outputDir, outputFile);
  if (!existsSync(outputPath)) {
    throw new Error(`Expected output file not found: ${outputPath}`);
  }

  const parsed = JSON.parse(readFileSync(outputPath, 'utf-8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Output file has invalid format (expected array): ${outputPath}`);
  }
  if (parsed.length === 0) {
    throw new Error(`Output file is empty (0 threads): ${outputPath}`);
  }

  console.log(`[forum-scraper] Completed ${forum}: ${parsed.length} threads -> ${outputPath}`);
  return { outputFile: outputPath, threadCount: parsed.length };
}

function runIngestion(): void {
  console.log('\n[forum-scraper] Triggering ingestion: npm run ingest-forums');
  const proc = spawnSync('npm', ['run', 'ingest-forums'], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env
  });
  if (proc.error) {
    throw new Error(`Failed running ingest-forums: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    throw new Error(`ingest-forums failed with exit code ${proc.status}`);
  }
}

function main(): void {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[forum-scraper] ${error instanceof Error ? error.message : String(error)}`);
    printUsage();
    process.exit(1);
  }

  if (opts.help) {
    printUsage();
    return;
  }

  const config = readForumConfig(opts.configPath);
  const outputDir = join(
    process.cwd(),
    config.defaults?.output_dir || join('data', 'raw', 'community_forums')
  );
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const forums = buildForumList(config, opts.forum);
  console.log(`[forum-scraper] Forums to scrape: ${forums.join(', ')}`);

  let totalThreads = 0;
  for (const forum of forums) {
    const result = runForumScrape(forum, opts, outputDir);
    totalThreads += result.threadCount;
  }

  console.log(`\n[forum-scraper] Scraping complete. Total threads written: ${totalThreads}`);

  if (opts.ingest) {
    runIngestion();
  }
}

main();
