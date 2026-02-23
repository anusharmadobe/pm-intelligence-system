/**
 * Slack Notification Service
 *
 * Sends notifications to Slack via incoming webhooks
 */

import { logger } from '../utils/logger';

export interface SlackMessage {
  text: string;
  blocks?: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    fields?: Array<{
      type: string;
      text: string;
    }>;
    elements?: Array<{
      type: string;
      text: string;
    }>;
    accessory?: any;
  }>;
}

export class SlackNotificationService {
  private webhookUrl: string | null;

  constructor() {
    this.webhookUrl = process.env.SLACK_WEBHOOK_URL || null;

    if (!this.webhookUrl) {
      logger.warn('SLACK_WEBHOOK_URL not configured - Slack notifications disabled');
    }
  }

  /**
   * Check if Slack notifications are enabled
   */
  isEnabled(): boolean {
    return !!this.webhookUrl;
  }

  /**
   * Send a simple text message to Slack
   */
  async sendText(text: string): Promise<void> {
    if (!this.isEnabled()) {
      logger.debug('Slack notification skipped (not configured)', { text });
      return;
    }

    await this.sendMessage({ text });
  }

  /**
   * Send a budget alert notification to Slack
   */
  async sendBudgetAlert(params: {
    agentName: string;
    threshold: number;
    currentCost: number;
    budgetLimit: number;
    utilizationPct: number;
    severity: 'info' | 'warning' | 'critical';
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const emoji = params.severity === 'critical' ? '🚨' : params.severity === 'warning' ? '⚠️' : 'ℹ️';
    const color = params.severity === 'critical' ? '#dc2626' : params.severity === 'warning' ? '#ea580c' : '#3b82f6';

    const message: SlackMessage = {
      text: `${emoji} Budget Alert: ${params.agentName}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} Budget Alert: ${params.agentName}`,
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Threshold:*\n${params.threshold}%`
            },
            {
              type: 'mrkdwn',
              text: `*Current Utilization:*\n${params.utilizationPct.toFixed(1)}%`
            },
            {
              type: 'mrkdwn',
              text: `*Current Cost:*\n$${params.currentCost.toFixed(2)}`
            },
            {
              type: 'mrkdwn',
              text: `*Budget Limit:*\n$${params.budgetLimit.toFixed(2)}`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: params.severity === 'critical'
              ? '🚨 *The agent has exceeded its budget and has been auto-paused.* Contact an admin to unpause.'
              : params.severity === 'warning'
              ? '⚠️ *Warning:* The agent is approaching its budget limit.'
              : 'ℹ️ The agent has reached 50% of its monthly budget.'
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Severity: *${params.severity.toUpperCase()}* | Timestamp: ${new Date().toISOString()}`
            }
          ]
        }
      ]
    };

    await this.sendMessage(message);
  }

  /**
   * Send a cost anomaly notification to Slack
   */
  async sendCostAnomaly(params: {
    agentName: string;
    currentCost: number;
    expectedCost: number;
    percentageIncrease: number;
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const message: SlackMessage = {
      text: `📊 Cost Anomaly Detected: ${params.agentName}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `📊 Cost Anomaly Detected: ${params.agentName}`,
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Current Cost:*\n$${params.currentCost.toFixed(2)}`
            },
            {
              type: 'mrkdwn',
              text: `*Expected Cost:*\n$${params.expectedCost.toFixed(2)}`
            },
            {
              type: 'mrkdwn',
              text: `*Increase:*\n${params.percentageIncrease.toFixed(1)}%`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '📊 This agent is spending significantly more than expected. Review recent activity for potential issues.'
          }
        }
      ]
    };

    await this.sendMessage(message);
  }

  /**
   * Send a daily cost summary to Slack
   */
  async sendDailyCostSummary(params: {
    date: string;
    totalCost: number;
    operationCount: number;
    topAgents: Array<{ name: string; cost: number }>;
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const topAgentsText = params.topAgents
      .map((agent, idx) => `${idx + 1}. ${agent.name}: $${agent.cost.toFixed(2)}`)
      .join('\n');

    const message: SlackMessage = {
      text: `📊 Daily Cost Summary: ${params.date}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `📊 Daily Cost Summary: ${params.date}`,
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Total Cost:*\n$${params.totalCost.toFixed(2)}`
            },
            {
              type: 'mrkdwn',
              text: `*Operations:*\n${params.operationCount.toLocaleString()}`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Top Agents:*\n${topAgentsText}`
          }
        }
      ]
    };

    await this.sendMessage(message);
  }

  /**
   * Send a generic message to Slack
   */
  private async sendMessage(message: SlackMessage): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Slack webhook failed: ${response.status} ${errorText}`);
      }

      logger.debug('Slack notification sent successfully', {
        text: message.text
      });
    } catch (error: any) {
      logger.error('Failed to send Slack notification', {
        error: error.message,
        webhookUrl: this.webhookUrl?.substring(0, 50) + '...'
      });
      // Don't throw - notification failures shouldn't break the application
    }
  }
}

// Singleton instance
let slackNotificationService: SlackNotificationService | null = null;

export function getSlackNotificationService(): SlackNotificationService {
  if (!slackNotificationService) {
    slackNotificationService = new SlackNotificationService();
  }
  return slackNotificationService;
}
