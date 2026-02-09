#!/usr/bin/env ts-node
/**
 * Ingest raw Slack messages from customer_engagement JSON file into signals table
 * WITH LLM-powered extraction, theme classification, and embedding queue
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDbPool, closeDbPool } from '../backend/db/connection';
import { Signal } from '../backend/processing/signal_extractor';
import { classifySignalThemes } from '../backend/services/theme_classifier_service';
import { createLLMProviderFromEnv, LLMProvider } from '../backend/services/llm_service';
import { extractSlackSignalWithLLM } from '../backend/services/slack_llm_extractor';
import { ingestSlackExtraction } from '../backend/services/slack_llm_extraction_service';
import { queueSignalForEmbedding } from '../backend/services/embedding_service';
import { extractCustomerNames } from '../backend/utils/text_processing';
import { logger } from '../backend/utils/logger';

const CHANNEL_ID = 'C04D195JVGS';
const DATA_DIR = join(process.cwd(), 'data', 'raw', 'slack', CHANNEL_ID);
const DATA_FILE = join(DATA_DIR, `customer_engagement_${CHANNEL_ID}_complete.json`);

// Configuration
const USE_LLM = process.env.USE_LLM !== 'false'; // Default true
const QUEUE_EMBEDDINGS = process.env.QUEUE_EMBEDDINGS !== 'false'; // Default true
const THEME_LLM_MODE = (process.env.THEME_LLM_MODE as 'fallback' | 'always' | 'hybrid') || 'hybrid';
const THEME_MIN_CONFIDENCE = parseFloat(process.env.THEME_MIN_CONFIDENCE || '0.2');
const MIN_QUALITY_FOR_LLM = parseFloat(process.env.MIN_QUALITY_FOR_LLM || '40');

interface RawSlackMessage {
  text?: string;
  ts: string;
  user?: string;
  username?: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
  bot_id?: string;
  blocks?: any[];
}

interface Engagement {
  id: string;
  timestamp: string;
  date: string;
  customerName?: string;
  pmName?: string;
  attendees?: string[];
  notes?: string;
  nextActions?: string[];
  rawData: RawSlackMessage;
  threadReplies?: Engagement[];
}

interface EngagementData {
  channelId: string;
  fetchedAt: string;
  totalEngagements: number;
  totalThreads: number;
  totalReplies: number;
  engagements: Engagement[];
}

function extractTextContent(message: RawSlackMessage): string {
  if (message.text) return message.text;
  
  if (message.blocks) {
    const texts: string[] = [];
    for (const block of message.blocks) {
      if (block.type === 'rich_text' && block.elements) {
        texts.push(extractFromElements(block.elements));
      }
    }
    return texts.join('\n');
  }
  
  return '';
}

function extractFromElements(elements: any[]): string {
  const texts: string[] = [];
  for (const el of elements) {
    if (el.type === 'rich_text_section' && el.elements) {
      texts.push(extractFromElements(el.elements));
    } else if (el.type === 'rich_text_list' && el.elements) {
      for (const item of el.elements) {
        if (item.elements) {
          texts.push('• ' + extractFromElements(item.elements));
        }
      }
    } else if (el.text) {
      texts.push(el.text);
    } else if (el.type === 'user') {
      texts.push(`@${el.user_id || 'user'}`);
    } else if (el.type === 'link') {
      texts.push(el.url || '');
    }
  }
  return texts.join('');
}

async function ingestEngagement(
  pool: any,
  engagement: Engagement,
  channelId: string,
  llmProvider: LLMProvider | null
): Promise<{ signalId: string; themes: string[]; llmExtracted: boolean } | null> {
  try {
    // Get the raw text content
    const rawText = extractTextContent(engagement.rawData);
    if (!rawText || rawText.length < 20) {
      return null;
    }

    // Determine signal type based on content
    let signalType = 'feedback';
    const lowerText = rawText.toLowerCase();
    if (lowerText.includes('feature request') || lowerText.includes('would like') || lowerText.includes('need to')) {
      signalType = 'feature_request';
    } else if (lowerText.includes('issue') || lowerText.includes('problem') || lowerText.includes('bug') || lowerText.includes('error')) {
      signalType = 'issue';
    } else if (lowerText.includes('pain') || lowerText.includes('frustrat') || lowerText.includes('difficult')) {
      signalType = 'pain_point';
    }

    // Calculate quality score based on text length and richness
    const textLength = rawText.length;
    let qualityScore = 0.3;
    if (textLength > 500) qualityScore = 0.8;
    else if (textLength > 200) qualityScore = 0.6;
    else if (textLength > 100) qualityScore = 0.5;
    else if (textLength > 50) qualityScore = 0.4;
    const extractedCustomers = extractCustomerNames(rawText);
    if (extractedCustomers.length > 0) qualityScore += 0.05;
    if ((engagement.threadReplies?.length || 0) >= 3) qualityScore += 0.05;
    if (engagement.customerName && engagement.customerName !== 'Unknown') qualityScore += 0.05;
    qualityScore = Math.min(1, qualityScore);
    const metadataQualityScore = Math.round(qualityScore * 100);

    // Build metadata (quality_score stored as integer 0-100 per schema index)
    const metadata = {
      customerName: engagement.customerName,
      pmName: engagement.pmName,
      attendees: engagement.attendees,
      slackTs: engagement.timestamp,
      channelId: channelId,
      date: engagement.date,
      hasReplies: (engagement.threadReplies?.length || 0) > 0,
      replyCount: engagement.threadReplies?.length || 0,
      quality_score: metadataQualityScore
    };

    // Create signal object for classification and extraction
    const signalId = uuidv4();
    const normalizedContent = rawText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    
    const signal: Signal = {
      id: signalId,
      source: 'slack',
      source_ref: engagement.timestamp,
      signal_type: signalType,
      content: rawText,
      normalized_content: normalizedContent,
      severity: null,
      confidence: null,
      metadata: metadata,
      created_at: new Date(parseFloat(engagement.timestamp) * 1000)
    };

    // Classify themes (with LLM fallback if provider available)
    const themeResults = await classifySignalThemes(
      signal,
      {
        useLLMFallback: USE_LLM && !!llmProvider,
        llmMode: THEME_LLM_MODE,
        minConfidence: THEME_MIN_CONFIDENCE
      },
      llmProvider || undefined
    );
    const themes = themeResults.map(t => t.themeName);

    // Insert into signals table
    await pool.query(
      `INSERT INTO signals (id, content, normalized_content, signal_type, source, source_ref, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        signalId,
        rawText.substring(0, 10000),
        normalizedContent.substring(0, 10000),
        signalType,
        'slack',
        engagement.timestamp,
        JSON.stringify(metadata),
        signal.created_at
      ]
    );

    // Insert theme associations
    for (const theme of themeResults) {
      await pool.query(
        `INSERT INTO signal_theme_hierarchy (signal_id, theme_id, confidence, matched_at_level, matched_keywords)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [signalId, theme.themeId, theme.confidence, theme.level, theme.matchedKeywords]
      );
    }

    // LLM Entity Extraction (if LLM provider available)
    let llmExtracted = false;
    if (USE_LLM && llmProvider && metadataQualityScore >= MIN_QUALITY_FOR_LLM) {
      try {
        const extraction = await extractSlackSignalWithLLM(signal, llmProvider);
        await ingestSlackExtraction(signalId, extraction, 'azure_openai', 'gpt-4o');
        const hasEntities = (extraction.customers?.length || 0) > 0
          || (extraction.features?.length || 0) > 0
          || (extraction.issues?.length || 0) > 0;
        if (hasEntities) {
          const updatedQualityScore = Math.min(100, metadata.quality_score + 10);
          metadata.quality_score = updatedQualityScore;
          await pool.query(
            `UPDATE signals
             SET metadata = jsonb_set(metadata, '{quality_score}', $1::jsonb)
             WHERE id = $2`,
            [JSON.stringify(updatedQualityScore), signalId]
          );
        }
        llmExtracted = true;
      } catch (llmError: any) {
        logger.debug('LLM extraction failed, continuing', { signalId, error: llmError.message });
      }
    }

    // Queue for embedding generation
    if (QUEUE_EMBEDDINGS) {
      try {
        await queueSignalForEmbedding(signalId, 5);
      } catch (queueError: any) {
        logger.debug('Failed to queue for embedding', { signalId, error: queueError.message });
      }
    }

    return { signalId, themes, llmExtracted };
  } catch (error: any) {
    logger.warn('Failed to ingest engagement', { error: error.message, engagementId: engagement.id });
    return null;
  }
}

async function ingestReply(
  pool: any,
  reply: Engagement,
  parentSignalId: string,
  channelId: string,
  llmProvider: LLMProvider | null
): Promise<{ signalId: string; llmExtracted: boolean } | null> {
  try {
    const rawText = extractTextContent(reply.rawData);
    if (!rawText || rawText.length < 10) {
      return null;
    }

    const signalId = uuidv4();
    let qualityScore = rawText.length > 100 ? 0.4 : 0.3;
    const extractedCustomers = extractCustomerNames(rawText);
    if (extractedCustomers.length > 0) qualityScore += 0.05;
    qualityScore = Math.min(1, qualityScore);
    const metadataQualityScore = Math.round(qualityScore * 100);
    const normalizedContent = rawText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const metadata = {
      slackTs: reply.timestamp,
      channelId: channelId,
      parentSignalId: parentSignalId,
      isReply: true,
      quality_score: metadataQualityScore
    };

    await pool.query(
      `INSERT INTO signals (id, content, normalized_content, signal_type, source, source_ref, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        signalId,
        rawText.substring(0, 10000),
        normalizedContent.substring(0, 10000),
        'feedback',
        'slack',
        reply.timestamp,
        JSON.stringify(metadata),
        new Date(parseFloat(reply.timestamp) * 1000)
      ]
    );

    // LLM extraction for replies (if content is substantial)
    let llmExtracted = false;
    if (USE_LLM && llmProvider && rawText.length > 50 && metadataQualityScore >= MIN_QUALITY_FOR_LLM) {
      try {
        const signal: Signal = {
          id: signalId,
          source: 'slack',
          source_ref: reply.timestamp,
          signal_type: 'feedback',
          content: rawText,
          normalized_content: normalizedContent,
          severity: null,
          confidence: null,
          metadata: metadata,
          created_at: new Date(parseFloat(reply.timestamp) * 1000)
        };
        const extraction = await extractSlackSignalWithLLM(signal, llmProvider);
        await ingestSlackExtraction(signalId, extraction, 'azure_openai', 'gpt-4o');
        const hasEntities = (extraction.customers?.length || 0) > 0
          || (extraction.features?.length || 0) > 0
          || (extraction.issues?.length || 0) > 0;
        if (hasEntities) {
          const updatedQualityScore = Math.min(100, metadata.quality_score + 10);
          metadata.quality_score = updatedQualityScore;
          await pool.query(
            `UPDATE signals
             SET metadata = jsonb_set(metadata, '{quality_score}', $1::jsonb)
             WHERE id = $2`,
            [JSON.stringify(updatedQualityScore), signalId]
          );
        }
        llmExtracted = true;
      } catch (llmError: any) {
        // Silent fail for replies
      }
    }

    // Queue for embedding
    if (QUEUE_EMBEDDINGS) {
      try {
        await queueSignalForEmbedding(signalId, 7); // Lower priority for replies
      } catch (queueError: any) {
        // Silent fail
      }
    }

    return { signalId, llmExtracted };
  } catch (error: any) {
    return null;
  }
}

async function main() {
  console.log('\n🚀 Starting LLM-Enabled Slack Message Ingestion\n');
  console.log('='.repeat(60));
  console.log(`   LLM Processing: ${USE_LLM ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   Embedding Queue: ${QUEUE_EMBEDDINGS ? 'ENABLED' : 'DISABLED'}`);
  console.log('='.repeat(60));

  const pool = getDbPool();
  let llmProvider: LLMProvider | null = null;

  // Initialize LLM provider
  if (USE_LLM) {
    try {
      console.log('\n🤖 Initializing Azure OpenAI LLM provider...');
      llmProvider = createLLMProviderFromEnv();
      console.log('   ✓ LLM provider initialized');
    } catch (error: any) {
      console.log(`   ⚠ LLM provider failed: ${error.message}`);
      console.log('   Continuing with keyword-only processing...');
    }
  }

  try {
    // Read the data file
    console.log('\n📖 Reading raw Slack data...');
    const rawData = readFileSync(DATA_FILE, 'utf-8');
    const data: EngagementData = JSON.parse(rawData);

    console.log(`   Channel: ${data.channelId}`);
    console.log(`   Total Engagements: ${data.totalEngagements}`);
    console.log(`   Total Replies: ${data.totalReplies}`);

    // Clear existing data for fresh run
    console.log('\n🗑️  Clearing existing data...');
    await pool.query('DELETE FROM signal_extractions');
    await pool.query('DELETE FROM signal_entities');
    await pool.query('DELETE FROM signal_theme_hierarchy');
    await pool.query('DELETE FROM signal_embeddings');
    await pool.query('DELETE FROM embedding_queue');
    await pool.query('DELETE FROM signals');
    console.log('   ✓ Cleared existing data');

    // Process engagements
    console.log('\n📥 Processing engagements with LLM...');
    let successCount = 0;
    let replyCount = 0;
    let llmExtractionCount = 0;
    const themeStats: Record<string, number> = {};
    const customerStats: Record<string, number> = {};

    for (let i = 0; i < data.engagements.length; i++) {
      const engagement = data.engagements[i];
      
      const result = await ingestEngagement(pool, engagement, data.channelId, llmProvider);
      
      if (result) {
        successCount++;
        if (result.llmExtracted) llmExtractionCount++;
        
        // Track themes
        for (const theme of result.themes) {
          themeStats[theme] = (themeStats[theme] || 0) + 1;
        }
        
        // Track customers
        if (engagement.customerName) {
          const customer = engagement.customerName.replace(/\*/g, '').trim();
          customerStats[customer] = (customerStats[customer] || 0) + 1;
        }

        // Process thread replies
        if (engagement.threadReplies && engagement.threadReplies.length > 0) {
          for (const reply of engagement.threadReplies) {
            const replyResult = await ingestReply(pool, reply, result.signalId, data.channelId, llmProvider);
            if (replyResult) {
              replyCount++;
              if (replyResult.llmExtracted) llmExtractionCount++;
            }
          }
        }
      }

      // Progress indicator
      if ((i + 1) % 25 === 0) {
        console.log(`   Processed ${i + 1}/${data.engagements.length} engagements (${llmExtractionCount} LLM extractions)...`);
      }
    }

    console.log(`   ✓ Ingested ${successCount} engagements`);
    console.log(`   ✓ Ingested ${replyCount} thread replies`);
    console.log(`   ✓ LLM extractions: ${llmExtractionCount}`);

    // Generate summary statistics
    console.log('\n📊 Generating summary...');

    // Get counts
    const signalResult = await pool.query('SELECT COUNT(*) as count FROM signals');
    const themeResult = await pool.query('SELECT COUNT(*) as count FROM signal_theme_hierarchy');
    const extractionResult = await pool.query('SELECT COUNT(*) as count FROM signal_extractions');
    const queueResult = await pool.query('SELECT COUNT(*) as count FROM embedding_queue WHERE status = $1', ['pending']);

    console.log('\n' + '='.repeat(60));
    console.log('📊 INGESTION SUMMARY');
    console.log('='.repeat(60));
    console.log(`\nTotal Signals Created: ${signalResult.rows[0].count}`);
    console.log(`Total Theme Associations: ${themeResult.rows[0].count}`);
    console.log(`LLM Extractions Stored: ${extractionResult.rows[0].count}`);
    console.log(`Signals Queued for Embedding: ${queueResult.rows[0].count}`);
    
    console.log(`\nTop Themes:`);
    const sortedThemes = Object.entries(themeStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [theme, count] of sortedThemes) {
      console.log(`   • ${theme}: ${count} signals`);
    }

    console.log(`\nTop Customers:`);
    const sortedCustomers = Object.entries(customerStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [customer, count] of sortedCustomers) {
      console.log(`   • ${customer}: ${count} engagements`);
    }

    // Show LLM extraction sample
    if (extractionResult.rows[0].count > 0) {
      console.log('\n📋 Sample LLM Extraction:');
      const sampleExtraction = await pool.query(`
        SELECT se.extraction, s.content 
        FROM signal_extractions se 
        JOIN signals s ON s.id = se.signal_id 
        LIMIT 1
      `);
      if (sampleExtraction.rows.length > 0) {
        const ext = sampleExtraction.rows[0].extraction;
        console.log(`   Customers: ${ext.customers?.map((c: any) => c.name).join(', ') || 'none'}`);
        console.log(`   Features: ${ext.features?.map((f: any) => f.name).join(', ') || 'none'}`);
        console.log(`   Issues: ${ext.issues?.length || 0}`);
        console.log(`   Requests: ${ext.requests?.length || 0}`);
      }
    }

    // Detect opportunities
    console.log('\n🔍 Detecting opportunities...');
    const opportunityQuery = `
      SELECT 
        sth.theme_id,
        th.name as theme_name,
        COUNT(DISTINCT sth.signal_id) as signal_count,
        AVG(sth.confidence) as avg_confidence
      FROM signal_theme_hierarchy sth
      JOIN theme_hierarchy th ON th.id = sth.theme_id
      GROUP BY sth.theme_id, th.name
      HAVING COUNT(DISTINCT sth.signal_id) >= 3
      ORDER BY signal_count DESC
      LIMIT 10
    `;
    
    const opportunities = await pool.query(opportunityQuery);
    
    console.log('\n🎯 TOP OPPORTUNITIES (themes with 3+ signals):');
    console.log('-'.repeat(50));
    
    for (const opp of opportunities.rows) {
      console.log(`   📌 ${opp.theme_name}`);
      console.log(`      Signals: ${opp.signal_count} | Avg Confidence: ${(opp.avg_confidence * 100).toFixed(0)}%`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ LLM-Enabled Ingestion Complete!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('  1. Process embedding queue: npm run process-embeddings');
    console.log('  2. View signals: curl http://localhost:3000/api/signals');
    console.log('  3. Search: curl "http://localhost:3000/api/search/text?q=pdf"');
    console.log('  4. Generate JIRA issues: curl http://localhost:3000/api/jira/generate');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await closeDbPool();
  }
}

main().catch(console.error);
