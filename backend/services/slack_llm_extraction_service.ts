import { logger } from '../utils/logger';
import { getDbPool } from '../db/connection';
import {
  normalizeCustomerName,
  upsertCustomer,
  upsertFeature,
  upsertIssue,
  insertSignalEntity,
  upsertTheme,
  upsertCustomerFeatureUsage,
  insertCustomerIssueReport
} from './slack_entity_helpers';

export interface SlackLLMExtraction {
  customers?: Array<{ name: string; confidence?: number }>;
  features?: Array<{ name: string; confidence?: number }>;
  issues?: Array<{ title?: string; category?: string; severity?: number; confidence?: number }>;
  themes?: Array<{ name: string; confidence?: number }>;
  requests?: Array<{ text: string; confidence?: number }>;
}

function normalizeIssueTitle(value?: string): string {
  const base = value && value.trim().length > 0 ? value : 'Issue reported';
  return base.replace(/\s+/g, ' ').trim().slice(0, 140);
}

export async function ingestSlackExtraction(
  signalId: string,
  extraction: SlackLLMExtraction,
  source: string = 'llm',
  model?: string | null
): Promise<void> {
  logger.debug('Starting LLM extraction ingestion', {
    stage: 'llm_extraction',
    status: 'start',
    signal_id: signalId,
    source,
    model,
    entity_counts: {
      customers: extraction.customers?.length || 0,
      features: extraction.features?.length || 0,
      themes: extraction.themes?.length || 0,
      issues: extraction.issues?.length || 0
    }
  });

  try {
    const pool = getDbPool();

    await pool.query(
      `INSERT INTO signal_extractions (signal_id, extraction, source, model)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (signal_id) DO UPDATE SET
         extraction = EXCLUDED.extraction,
         source = EXCLUDED.source,
         model = EXCLUDED.model`,
      [signalId, JSON.stringify(extraction), source, model || null]
    );

  const customerIds: string[] = [];
  for (const customer of extraction.customers || []) {
    if (!customer?.name) continue;
    const customerId = await upsertCustomer(normalizeCustomerName(customer.name));
    customerIds.push(customerId);
    await insertSignalEntity(signalId, 'customer', customerId, customer.confidence ?? 0.75);
  }

  const featureIds: string[] = [];
  for (const feature of extraction.features || []) {
    if (!feature?.name) continue;
    const featureId = await upsertFeature(feature.name);
    featureIds.push(featureId);
    await insertSignalEntity(signalId, 'feature', featureId, feature.confidence ?? 0.7);
  }

  for (const theme of extraction.themes || []) {
    if (!theme?.name) continue;
    const themeId = await upsertTheme(theme.name);
    await insertSignalEntity(signalId, 'theme', themeId, theme.confidence ?? 0.6);
  }

  const issueIds: string[] = [];
  for (const issue of extraction.issues || []) {
    const title = normalizeIssueTitle(issue?.title);
    const category = issue?.category || 'uncategorized';
    const severity = typeof issue?.severity === 'number' ? issue.severity : null;
    const issueId = await upsertIssue(
      { title, category, severity, confidence: issue?.confidence ?? 0.6 },
      new Date()
    );
    issueIds.push(issueId);
    await insertSignalEntity(signalId, 'issue', issueId, issue?.confidence ?? 0.6);
  }

  // Create customer-feature usage relationships
  if (customerIds.length > 0 && featureIds.length > 0) {
    const totalRelationships = customerIds.length * featureIds.length;
    logger.debug('Creating customer-feature usage relationships', {
      stage: 'llm_extraction',
      status: 'relationships_start',
      signal_id: signalId,
      customer_count: customerIds.length,
      feature_count: featureIds.length,
      total_relationships: totalRelationships
    });

    const relationshipStartTime = Date.now();
    let processedCount = 0;

    for (const customerId of customerIds) {
      for (const featureId of featureIds) {
        await upsertCustomerFeatureUsage(customerId, featureId, new Date(), 1);
        processedCount++;

        // Log progress for large relationship counts (every 50 relationships)
        if (totalRelationships > 100 && processedCount % 50 === 0) {
          logger.debug('Customer-feature relationship progress', {
            stage: 'llm_extraction',
            status: 'relationships_progress',
            signal_id: signalId,
            processed: processedCount,
            total: totalRelationships,
            progress_pct: ((processedCount / totalRelationships) * 100).toFixed(1)
          });
        }
      }
    }

    logger.debug('Customer-feature relationships created', {
      stage: 'llm_extraction',
      status: 'relationships_complete',
      signal_id: signalId,
      count: totalRelationships,
      duration_ms: Date.now() - relationshipStartTime
    });
  }

  // Create customer-issue report relationships
  if (customerIds.length > 0 && issueIds.length > 0) {
    const totalReports = customerIds.length * issueIds.length;
    logger.debug('Creating customer-issue report relationships', {
      stage: 'llm_extraction',
      status: 'issue_reports_start',
      signal_id: signalId,
      customer_count: customerIds.length,
      issue_count: issueIds.length,
      total_reports: totalReports
    });

    const reportStartTime = Date.now();
    let processedCount = 0;

    for (const customerId of customerIds) {
      for (const issueId of issueIds) {
        await insertCustomerIssueReport(customerId, issueId, signalId);
        processedCount++;

        // Log progress for large report counts (every 50 reports)
        if (totalReports > 100 && processedCount % 50 === 0) {
          logger.debug('Customer-issue report progress', {
            stage: 'llm_extraction',
            status: 'issue_reports_progress',
            signal_id: signalId,
            processed: processedCount,
            total: totalReports,
            progress_pct: ((processedCount / totalReports) * 100).toFixed(1)
          });
        }
      }
    }

    logger.debug('Customer-issue reports created', {
      stage: 'llm_extraction',
      status: 'issue_reports_complete',
      signal_id: signalId,
      count: totalReports,
      duration_ms: Date.now() - reportStartTime
    });
  }

    logger.info('LLM extraction ingestion complete', {
      stage: 'llm_extraction',
      status: 'success',
      signal_id: signalId,
      source,
      model,
      entities_created: {
        customers: customerIds.length,
        features: featureIds.length,
        issues: issueIds.length
      },
      relationships_created: {
        customer_feature_usage: customerIds.length * featureIds.length,
        customer_issue_reports: customerIds.length * issueIds.length
      }
    });
  } catch (error: any) {
    logger.error('LLM extraction ingestion failed', {
      stage: 'llm_extraction',
      status: 'error',
      signal_id: signalId,
      source,
      model,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}
