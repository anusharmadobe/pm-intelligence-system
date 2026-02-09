import { randomUUID } from 'crypto';
import { getDbPool } from '../db/connection';
import { getSignalsForOpportunity } from './opportunity_service';
import { getAllOpportunities, Opportunity } from './opportunity_service';
import { synthesizeOpportunity, LLMProvider } from './llm_service';
import { logger } from '../utils/logger';

export interface Judgment {
  id: string;
  opportunity_id: string;
  summary: string;
  assumptions: Record<string, any>;
  missing_evidence: Record<string, any>;
  confidence_level: string;
  created_at: Date;
}

/**
 * Creates a judgment for an opportunity.
 * Requires human-in-the-loop (userId).
 * LLM assists reasoning but does not make decisions.
 * Uses Cursor's built-in LLM via llmProvider.
 */
export async function createJudgment(
  opportunityId: string,
  userId: string,
  llmProvider: LLMProvider
): Promise<Judgment> {
  logger.info('Creating judgment', { opportunityId, userId });
  
  if (!userId) {
    logger.error('Judgment creation failed: no user ID');
    throw new Error("Human required - judgments require human-in-the-loop");
  }

  if (!llmProvider) {
    logger.error('Judgment creation failed: no LLM provider');
    throw new Error("LLM provider required - uses Cursor's built-in LLM");
  }

  // Verify opportunity exists
  const opportunities = await getAllOpportunities();
  const opportunity = opportunities.find(opp => opp.id === opportunityId);
  if (!opportunity) {
    logger.error('Opportunity not found', { opportunityId });
    throw new Error(`Opportunity ${opportunityId} not found`);
  }

  // Get signals for this opportunity
  const signals = await getSignalsForOpportunity(opportunityId);
  if (signals.length === 0) {
    logger.warn('No signals found for opportunity', { opportunityId });
    throw new Error(`No signals found for opportunity ${opportunityId}`);
  }

  logger.info('Calling LLM for opportunity synthesis', { 
    opportunityId, 
    signalCount: signals.length 
  });

  // LLM assists reasoning (OPPORTUNITY_SYNTHESIS) - uses Cursor's built-in LLM
  const llmResponse = await synthesizeOpportunity(signals, opportunity, llmProvider);

  logger.info('LLM synthesis complete', { 
    opportunityId,
    assumptionsCount: llmResponse.assumptions?.length || 0,
    missingEvidenceCount: llmResponse.missing_evidence?.length || 0
  });

  // Create judgment (append-only, never overwrites)
  const judgment: Judgment = {
    id: randomUUID(),
    opportunity_id: opportunityId,
    summary: llmResponse.content,
    assumptions: { items: llmResponse.assumptions || [] },
    missing_evidence: { items: llmResponse.missing_evidence || [] },
    confidence_level: determineConfidenceLevel(signals, llmResponse),
    created_at: new Date()
  };

  await storeJudgment(judgment);

  logger.info('Judgment created successfully', { 
    judgmentId: judgment.id, 
    opportunityId,
    confidenceLevel: judgment.confidence_level
  });

  return judgment;
}

/**
 * Stores a judgment in the database.
 * Judgments are append-only - new judgments are created, never updated.
 */
async function storeJudgment(judgment: Judgment): Promise<void> {
  const pool = getDbPool();
  
  await pool.query(
    `INSERT INTO judgments (id, opportunity_id, summary, assumptions, missing_evidence, confidence_level, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      judgment.id,
      judgment.opportunity_id,
      judgment.summary,
      JSON.stringify(judgment.assumptions),
      JSON.stringify(judgment.missing_evidence),
      judgment.confidence_level,
      judgment.created_at
    ]
  );
}

/**
 * Determines confidence level based on signals and LLM analysis.
 */
function determineConfidenceLevel(signals: any[], llmResponse: any): string {
  const signalCount = signals.length;
  const hasMissingEvidence = (llmResponse.missing_evidence?.length || 0) > 0;
  const hasAssumptions = (llmResponse.assumptions?.length || 0) > 0;

  if (signalCount >= 5 && !hasMissingEvidence && !hasAssumptions) {
    return 'high';
  } else if (signalCount >= 3 && hasMissingEvidence) {
    return 'medium';
  } else {
    return 'low';
  }
}

/**
 * Creates a judgment from pre-generated data (used by extension).
 * Extension provides LLM-generated content via API.
 */
export async function createJudgmentFromData(data: {
  opportunityId: string;
  userId: string;
  analysis: string;
  recommendation: string;
  confidence: number;
  reasoning?: string;
}): Promise<Judgment> {
  logger.info('Creating judgment from extension data', { 
    opportunityId: data.opportunityId, 
    userId: data.userId 
  });

  // Verify opportunity exists
  const opportunities = await getAllOpportunities();
  const opportunity = opportunities.find(opp => opp.id === data.opportunityId);
  if (!opportunity) {
    logger.error('Opportunity not found', { opportunityId: data.opportunityId });
    throw new Error(`Opportunity ${data.opportunityId} not found`);
  }

  // Get signals for confidence level calculation
  const signals = await getSignalsForOpportunity(data.opportunityId);
  
  // Determine confidence level
  const signalCount = signals.length;
  const confidenceLevel = signalCount >= 5 && data.confidence >= 0.8 ? 'high' :
                         signalCount >= 3 && data.confidence >= 0.6 ? 'medium' : 'low';

  // Create judgment from extension-provided data
  const judgment: Judgment = {
    id: randomUUID(),
    opportunity_id: data.opportunityId,
    summary: `${data.analysis}\n\nRecommendation: ${data.recommendation}${data.reasoning ? `\n\nReasoning: ${data.reasoning}` : ''}`,
    assumptions: { items: [] }, // Extension can provide these if needed
    missing_evidence: { items: [] }, // Extension can provide these if needed
    confidence_level: confidenceLevel,
    created_at: new Date()
  };

  await storeJudgment(judgment);

  logger.info('Judgment created from extension data', { 
    judgmentId: judgment.id, 
    opportunityId: data.opportunityId,
    confidenceLevel: judgment.confidence_level
  });

  return judgment;
}

/**
 * Retrieves all judgments for an opportunity.
 */
export async function getJudgmentsForOpportunity(opportunityId: string): Promise<Judgment[]> {
  const pool = getDbPool();
  const result = await pool.query(
    'SELECT * FROM judgments WHERE opportunity_id = $1 ORDER BY created_at DESC',
    [opportunityId]
  );
  return result.rows.map(row => ({
    ...row,
    assumptions: typeof row.assumptions === 'string' ? JSON.parse(row.assumptions) : row.assumptions,
    missing_evidence: typeof row.missing_evidence === 'string' ? JSON.parse(row.missing_evidence) : row.missing_evidence,
    created_at: new Date(row.created_at)
  }));
}

/**
 * Retrieves a judgment by ID.
 */
export async function getJudgmentById(judgmentId: string): Promise<Judgment | null> {
  const pool = getDbPool();
  const result = await pool.query('SELECT * FROM judgments WHERE id = $1', [judgmentId]);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    ...row,
    assumptions: typeof row.assumptions === 'string' ? JSON.parse(row.assumptions) : row.assumptions,
    missing_evidence: typeof row.missing_evidence === 'string' ? JSON.parse(row.missing_evidence) : row.missing_evidence,
    created_at: new Date(row.created_at)
  };
}
