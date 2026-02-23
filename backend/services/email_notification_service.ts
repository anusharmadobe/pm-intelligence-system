import nodemailer from 'nodemailer';
import { JiraIssueTemplate } from './jira_issue_service';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('email_notification', 'LOG_LEVEL_EMAIL');

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  from: string;
  to: string;
}

export interface PipelineEmailSummary {
  runId: string;
  durationSeconds: number;
  totalSignals: number;
  opportunitiesDetected: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class EmailNotificationService {
  private readonly config: EmailConfig | null;

  constructor() {
    this.config = this.getConfigFromEnv();
  }

  private getConfigFromEnv(): EmailConfig | null {
    const smtpHost = (process.env.SMTP_HOST || '').trim();
    if (!smtpHost) {
      return null;
    }
    const smtpPortRaw = process.env.SMTP_PORT || '25';
    const smtpPort = Number.parseInt(smtpPortRaw, 10);
    if (!Number.isFinite(smtpPort) || smtpPort <= 0) {
      logger.warn('Invalid SMTP_PORT; email notifications disabled', {
        smtpPortRaw
      });
      return null;
    }
    return {
      smtpHost,
      smtpPort,
      from: (process.env.EMAIL_FROM || 'pm-intelligence-system@adobe.com').trim(),
      to: (process.env.EMAIL_TO || 'anusharm@adobe.com').trim()
    };
  }

  private buildJiraRows(jiraIssues: JiraIssueTemplate[]): string {
    if (jiraIssues.length === 0) {
      return `
        <tr>
          <td colspan="10" style="padding:10px;border:1px solid #ddd;text-align:center;">
            No JIRA issues generated in this run.
          </td>
        </tr>
      `;
    }
    return jiraIssues
      .map((issue, index) => {
        const confidence = Number.isFinite(issue.confidenceScore)
          ? issue.confidenceScore.toFixed(1)
          : '0.0';
        return `
          <tr>
            <td style="padding:8px;border:1px solid #ddd;">${index + 1}</td>
            <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(issue.summary)}</td>
            <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(issue.issueType)}</td>
            <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(issue.priority)}</td>
            <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(issue.area || 'Unknown')}</td>
            <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(issue.customerImpact)}</td>
            <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(issue.estimatedComplexity)}</td>
            <td style="padding:8px;border:1px solid #ddd;">${issue.uniqueCustomers || 0}</td>
            <td style="padding:8px;border:1px solid #ddd;">${issue.evidenceCount || 1}</td>
            <td style="padding:8px;border:1px solid #ddd;">${confidence}</td>
          </tr>
        `;
      })
      .join('\n');
  }

  private buildHtmlTable(jiraIssues: JiraIssueTemplate[], summary: PipelineEmailSummary): string {
    return `
      <div style="font-family:Arial,sans-serif;">
        <h2>PM Intelligence Pipeline Run Complete</h2>
        <p><strong>Run ID:</strong> ${escapeHtml(summary.runId)}</p>
        <p><strong>Duration:</strong> ${summary.durationSeconds}s</p>
        <p><strong>Total Signals Processed:</strong> ${summary.totalSignals}</p>
        <p><strong>Opportunities Detected:</strong> ${summary.opportunitiesDetected}</p>
        <p><strong>Generated JIRA Issues:</strong> ${jiraIssues.length}</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:8px;border:1px solid #ddd;">#</th>
              <th style="padding:8px;border:1px solid #ddd;">Summary</th>
              <th style="padding:8px;border:1px solid #ddd;">Type</th>
              <th style="padding:8px;border:1px solid #ddd;">Priority</th>
              <th style="padding:8px;border:1px solid #ddd;">Area</th>
              <th style="padding:8px;border:1px solid #ddd;">Impact</th>
              <th style="padding:8px;border:1px solid #ddd;">Complexity</th>
              <th style="padding:8px;border:1px solid #ddd;">Unique Reporters</th>
              <th style="padding:8px;border:1px solid #ddd;">Evidence</th>
              <th style="padding:8px;border:1px solid #ddd;">Confidence</th>
            </tr>
          </thead>
          <tbody>
            ${this.buildJiraRows(jiraIssues)}
          </tbody>
        </table>
      </div>
    `;
  }

  async sendJiraSummary(jiraIssues: JiraIssueTemplate[], pipelineSummary: PipelineEmailSummary): Promise<void> {
    if (!this.config) {
      logger.warn('SMTP is not configured; skipping JIRA summary email', {
        stage: 'email_notification',
        status: 'skipped'
      });
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: false
      });

      const subject = `PM Intelligence: ${jiraIssues.length} JIRA issues from pipeline run ${pipelineSummary.runId}`;
      await transporter.sendMail({
        from: this.config.from,
        to: this.config.to,
        subject,
        html: this.buildHtmlTable(jiraIssues, pipelineSummary)
      });

      logger.info('Pipeline completion email sent', {
        stage: 'email_notification',
        status: 'success',
        to: this.config.to,
        issueCount: jiraIssues.length,
        runId: pipelineSummary.runId
      });
    } catch (error: any) {
      logger.warn('Failed to send pipeline completion email', {
        stage: 'email_notification',
        status: 'error',
        error: error?.message || String(error)
      });
    }
  }
}
