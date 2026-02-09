#!/usr/bin/env ts-node

/**
 * Fetch and ingest messages from channel C04D195JVGS using MCP
 * This script uses MCP functions directly (available in Cursor IDE context)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ingestSignal, RawSignal } from '../backend/processing/signal_extractor';
import { logger } from '../backend/utils/logger';

const CHANNEL_ID = 'C04D195JVGS';
const LIMIT = 1000; // Fetch up to 1000 messages

async function fetchAndIngestMessages() {
  console.log('\n📥 Fetching and Ingesting Messages from Channel C04D195JVGS');
  console.log('='.repeat(70) + '\n');
  
  try {
    // Access MCP function directly (available in Cursor IDE)
    if (typeof (global as any).mcp_Slack_slack_get_channel_history !== 'function') {
      throw new Error('MCP function not available. This script must run in Cursor IDE context.');
    }
    
    console.log(`Fetching up to ${LIMIT} messages from channel ${CHANNEL_ID}...\n`);
    
    const getChannelHistory = (global as any).mcp_Slack_slack_get_channel_history;
    const history = await getChannelHistory({
      channel_id: CHANNEL_ID,
      limit: LIMIT
    });
    
    if (!history || !history.messages) {
      throw new Error('Invalid response from Slack MCP');
    }
    
    const messages = history.messages || [];
    console.log(`✅ Retrieved ${messages.length} messages\n`);
    
    if (messages.length === 0) {
      console.log('No messages found in channel.\n');
      return { ingested: 0, skipped: 0, total: 0 };
    }
    
    console.log('Ingesting messages as signals...\n');
    
    let ingestedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Process messages in reverse order (oldest first) for better chronological ingestion
    const messagesToProcess = [...messages].reverse();
    
    for (let i = 0; i < messagesToProcess.length; i++) {
      const message = messagesToProcess[i];
      
      // Skip bot messages that are just system notifications
      if (message.subtype === 'bot_message' && message.bot_id === 'B01' && message.user === 'USLACKBOT') {
        skippedCount++;
        continue;
      }
      
      // Extract text content
      let text = message.text || '';
      
      // For bot messages with blocks, extract text from blocks
      if (!text && message.blocks) {
        text = extractTextFromBlocks(message.blocks);
      }
      
      // Skip empty messages
      if (!text || text.trim().length === 0) {
        skippedCount++;
        continue;
      }
      
      const signal: RawSignal = {
        source: 'slack',
        id: message.ts || message.event_ts || `${Date.now()}-${i}`,
        type: message.subtype === 'bot_message' ? 'bot_message' : 'message',
        text: text,
        metadata: {
          channel_id: CHANNEL_ID,
          user: message.user,
          username: message.username,
          timestamp: message.ts,
          thread_ts: message.thread_ts,
          bot_id: message.bot_id,
          app_id: message.app_id,
          reply_count: message.reply_count,
          reply_users_count: message.reply_users_count
        }
      };
      
      try {
        await ingestSignal(signal);
        ingestedCount++;
        if (ingestedCount % 10 === 0) {
          process.stdout.write('.');
        }
      } catch (error: any) {
        if (error.message.includes('duplicate') || error.message.includes('already exists')) {
          skippedCount++;
        } else {
          errorCount++;
          logger.warn('Failed to ingest message', {
            error: error.message,
            messageTs: message.ts
          });
        }
      }
    }
    
    console.log('\n\n✅ Ingestion Complete!');
    console.log('='.repeat(70));
    console.log(`   Messages fetched: ${messages.length}`);
    console.log(`   Signals ingested: ${ingestedCount}`);
    console.log(`   Skipped: ${skippedCount} (duplicates/system messages)`);
    console.log(`   Errors: ${errorCount}\n`);
    
    logger.info('Channel ingestion complete', {
      channelId: CHANNEL_ID,
      ingestedCount,
      skippedCount,
      errorCount,
      totalMessages: messages.length
    });
    
    return { ingested: ingestedCount, skipped: skippedCount, total: messages.length };
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    logger.error('MCP ingestion failed', {
      error: error.message,
      stack: error.stack,
      channelId: CHANNEL_ID
    });
    throw error;
  }
}

function extractTextFromBlocks(blocks: any[]): string {
  const texts: string[] = [];
  
  for (const block of blocks) {
    if (block.type === 'rich_text' && block.elements) {
      texts.push(extractTextFromElements(block.elements));
    } else if (block.text) {
      texts.push(block.text);
    }
  }
  
  return texts.join('\n').trim();
}

function extractTextFromElements(elements: any[]): string {
  const texts: string[] = [];
  
  for (const element of elements) {
    if (element.type === 'rich_text_section') {
      if (element.elements) {
        texts.push(extractTextFromElements(element.elements));
      }
    } else if (element.type === 'rich_text_list') {
      if (element.elements) {
        element.elements.forEach((item: any) => {
          if (item.elements) {
            texts.push('• ' + extractTextFromElements(item.elements));
          }
        });
      }
    } else if (element.text) {
      texts.push(element.text);
    } else if (element.type === 'text') {
      texts.push(element.text || '');
    }
  }
  
  return texts.join('').trim();
}

if (require.main === module) {
  fetchAndIngestMessages()
    .then(result => {
      if (result && result.ingested > 0) {
        console.log('✅ Successfully ingested messages into PM Intelligence system!\n');
        process.exit(0);
      } else if (result && result.total === 0) {
        console.log('⚠️  No messages to ingest\n');
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      process.exit(1);
    });
}

export { fetchAndIngestMessages };
