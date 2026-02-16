#!/usr/bin/env ts-node

/**
 * Slack Alert Bot Agent
 *
 * Monitors for critical signals and sends Slack alerts
 * Subscribes to Redis Streams events
 *
 * Usage:
 *   npm run agent:slack-alert-bot
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getDbPool } from '../../backend/db/connection';
import { logger } from '../../backend/utils/logger';
import { WebClient } from '@slack/web-api';

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

interface AlertRule {
  name: string;
  condition: (signal: any) => boolean;
  message: (signal: any) => string;
  channel: string;
}

const alertRules: AlertRule[] = [
  {
    name: 'High Priority Issue',
    condition: (signal) => {
      const text = signal.text?.toLowerCase() || '';
      return text.includes('critical') || text.includes('p0') || text.includes('urgent');
    },
    message: (signal) => `🚨 *High Priority Issue Detected*\n\n${signal.text.slice(0, 200)}...\n\nSource: ${signal.source}`,
    channel: process.env.ALERT_CHANNEL || 'general'
  },
  {
    name: 'Customer Escalation',
    condition: (signal) => {
      const text = signal.text?.toLowerCase() || '';
      return (text.includes('escalation') || text.includes('complaint')) && signal.source === 'slack';
    },
    message: (signal) => `⚠️ *Customer Escalation*\n\n${signal.text.slice(0, 200)}...\n\nRequires immediate attention!`,
    channel: process.env.ALERT_CHANNEL || 'general'
  }
];

async function checkForAlerts() {
  const pool = getDbPool();

  // Check signals from last 5 minutes
  const recentSignals = await pool.query(
    `SELECT id, source, type, text, metadata, created_at
     FROM signals
     WHERE created_at >= NOW() - INTERVAL '5 minutes'
     ORDER BY created_at DESC
     LIMIT 100`
  );

  for (const signal of recentSignals.rows) {
    for (const rule of alertRules) {
      if (rule.condition(signal)) {
        await sendAlert(rule, signal);
      }
    }
  }
}

async function sendAlert(rule: AlertRule, signal: any) {
  try {
    const message = rule.message(signal);

    if (process.env.SLACK_BOT_TOKEN) {
      await slackClient.chat.postMessage({
        channel: rule.channel,
        text: message,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: message
            }
          }
        ]
      });
      logger.info('Alert sent to Slack', { rule: rule.name, signalId: signal.id });
    } else {
      console.log(`\n📢 ALERT: ${rule.name}`);
      console.log(message);
      console.log('');
    }
  } catch (error: any) {
    logger.error('Failed to send alert', { error: error.message, rule: rule.name });
  }
}

async function main() {
  console.log('\n🤖 Slack Alert Bot Started\n');
  console.log('Monitoring for critical signals...\n');

  // Run once immediately
  await checkForAlerts();

  // Then run every 5 minutes
  setInterval(async () => {
    try {
      await checkForAlerts();
    } catch (error: any) {
      logger.error('Alert check failed', { error: error.message });
    }
  }, 5 * 60 * 1000);
}

main().catch(err => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
