/**
 * Export signals into chat-ready batches with prompt templates.
 *
 * Usage:
 *   npx ts-node scripts/export_signals_for_chat.ts --batchSize 150 --maxSignals all
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

type Signal = {
  id: string;
  source?: string;
  content?: string;
  text?: string;
  created_at?: string;
  metadata?: Record<string, any> | null;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const prefix = `--${name}=`;
    const match = args.find((a) => a.startsWith(prefix));
    return match ? match.slice(prefix.length) : undefined;
  };

  const batchSize = Math.max(20, Math.min(500, parseInt(getArg('batchSize') || '150', 10)));
  const maxSignalsRaw = getArg('maxSignals') || 'all';
  const maxSignals = maxSignalsRaw.toLowerCase() === 'all' ? 0 : Math.max(1, parseInt(maxSignalsRaw, 10));
  const outputDir = getArg('outputDir');

  return { batchSize, maxSignals, outputDir };
}

async function jsonFetch(url: string): Promise<any> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function fetchSignals(maxSignals: number): Promise<Signal[]> {
  const pageSize = 200;
  const signals: Signal[] = [];
  let offset = 0;
  while (true) {
    const url = `${API_BASE}/api/signals?limit=${pageSize}&offset=${offset}`;
    const response = await jsonFetch(url);
    const batch = Array.isArray(response) ? response : response.signals || response.data || [];
    if (!batch.length) break;
    signals.push(...batch);
    offset += pageSize;
    if (maxSignals > 0 && signals.length >= maxSignals) {
      return signals.slice(0, maxSignals);
    }
  }
  return signals;
}

function toChatSignal(signal: Signal) {
  const text = (signal.content || signal.text || '').trim();
  const metadata = signal.metadata || {};
  const customers = Array.isArray(metadata.customers) ? metadata.customers : [];
  return {
    id: signal.id,
    source: signal.source || 'unknown',
    text,
    created_at: signal.created_at || metadata.timestamp || metadata.ts || null,
    customers,
    channel: metadata.channel || metadata.channel_id || null,
    thread_ts: metadata.thread_ts || null
  };
}

function buildPrompt(batchIndex: number, batchCount: number, batchFile: string) {
  return [
    'You are a product analyst. Cluster the provided signals into opportunities.',
    '',
    'Rules:',
    '- Use ONLY the attached JSON file for evidence.',
    '- Do NOT invent customers or details not present.',
    '- Output STRICT JSON ONLY. No markdown.',
    '',
    'Output format:',
    '{ "opportunities": [',
    '  {',
    '    "title": "short title",',
    '    "description": "1-2 sentences",',
    '    "signal_ids": ["..."],',
    '    "customers": ["optional", "list"]',
    '  }',
    '] }',
    '',
    `Batch ${batchIndex + 1} of ${batchCount}`,
    `File: ${batchFile}`
  ].join('\n');
}

async function main() {
  const { batchSize, maxSignals, outputDir } = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = outputDir
    ? path.resolve(outputDir)
    : path.resolve(__dirname, '..', 'exports', `chat_batches_${timestamp}`);

  const batchesDir = path.join(baseDir, 'batches');
  const promptsDir = path.join(baseDir, 'prompts');

  fs.mkdirSync(batchesDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });

  console.log(`API_BASE: ${API_BASE}`);
  console.log(`Fetching signals (maxSignals=${maxSignals || 'all'})...`);
  const signals = await fetchSignals(maxSignals);
  const chatSignals = signals.map(toChatSignal).filter((s) => s.text.length > 0);
  const total = chatSignals.length;
  const batchCount = Math.ceil(total / batchSize);

  const manifest = {
    api_base: API_BASE,
    total_signals: total,
    batch_size: batchSize,
    batch_count: batchCount,
    created_at: new Date().toISOString(),
    batches: [] as Array<{ batch: number; file: string; prompt: string; count: number }>
  };

  for (let i = 0; i < batchCount; i += 1) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, total);
    const batchSignals = chatSignals.slice(start, end);
    const batchName = `batch_${String(i + 1).padStart(3, '0')}`;
    const batchFile = path.join(batchesDir, `${batchName}.json`);
    const promptFile = path.join(promptsDir, `${batchName}_prompt.txt`);

    fs.writeFileSync(batchFile, JSON.stringify(batchSignals, null, 2), 'utf8');
    fs.writeFileSync(promptFile, buildPrompt(i, batchCount, path.basename(batchFile)), 'utf8');

    manifest.batches.push({
      batch: i + 1,
      file: path.relative(baseDir, batchFile),
      prompt: path.relative(baseDir, promptFile),
      count: batchSignals.length
    });
  }

  const readme = [
    '# Chat Batch Export',
    '',
    '1) Open a batch prompt file in `prompts/` and copy it into Cursor Chat.',
    '2) Attach the matching batch JSON from `batches/`.',
    '3) Ask Cursor to respond with strict JSON only.',
    '',
    'After each batch, save the JSON response (e.g., `batch_001_output.json`).',
    'You can later merge all batch outputs manually or with a script.',
    ''
  ].join('\n');

  fs.writeFileSync(path.join(baseDir, 'README.md'), readme, 'utf8');
  fs.writeFileSync(path.join(baseDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Export complete: ${baseDir}`);
  console.log(`Batches: ${batchCount} | Signals: ${total}`);
}

main().catch((error) => {
  console.error('Export failed:', error.message || error);
  process.exit(1);
});
