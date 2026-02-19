/**
 * JIRA Issue Generation Service
 * Uses LLM to generate well-structured JIRA issue templates from opportunities
 */

import { getDbPool } from '../db/connection';
import { Signal } from '../processing/signal_extractor';
import { LLMProvider, createLLMProviderFromEnv } from './llm_service';
import { 
  Opportunity, 
  ScoredOpportunity, 
  getSignalsForOpportunity,
  getOpportunitiesWithScores,
  OpportunityQueryOptions
} from './opportunity_service';
import { getThemePath } from '../config/theme_dictionary';
import { logger as globalLogger, createModuleLogger } from '../utils/logger';

// Create module-specific logger for JIRA operations
const logger = createModuleLogger('jira', 'LOG_LEVEL_JIRA');

/**
 * JIRA issue template structure
 */
export interface JiraIssueTemplate {
  // Core fields
  summary: string;           // Issue title (max 255 chars)
  issueType: 'Story' | 'Bug' | 'Task' | 'Epic' | 'Feature';
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  
  // Description using Confluence-compatible markdown
  description: string;
  
  // Labels and components
  labels: string[];
  components: string[];
  
  // Acceptance criteria
  acceptanceCriteria: string[];
  
  // Customer context
  affectedCustomers: string[];
  customerImpact: 'Critical' | 'High' | 'Medium' | 'Low';
  
  // Technical context
  technicalNotes: string;
  estimatedComplexity: 'XS' | 'S' | 'M' | 'L' | 'XL';
  
  // Metadata
  sourceOpportunityId: string;
  sourceSignalIds: string[];
  generatedAt: Date;
  confidenceScore: number;
  
  // Raw data for inspection
  rawLLMResponse?: string;
}

/**
 * Configuration for JIRA issue generation
 */
export interface JiraGenerationConfig {
  // LLM settings
  maxSignalsToInclude?: number;
  includeRawContent?: boolean;
  
  // Output preferences
  priorityMapping?: {
    highImpact: 'Highest' | 'High';
    mediumImpact: 'Medium';
    lowImpact: 'Low' | 'Lowest';
  };
  
  // Component/label mappings
  themeToComponent?: Record<string, string>;
  signalTypeToLabel?: Record<string, string>;
}

const DEFAULT_CONFIG: JiraGenerationConfig = {
  maxSignalsToInclude: 10,
  includeRawContent: false,
  priorityMapping: {
    highImpact: 'High',
    mediumImpact: 'Medium',
    lowImpact: 'Low'
  },
  signalTypeToLabel: {
    'feature_request': 'feature-request',
    'issue': 'customer-issue',
    'pain_point': 'pain-point',
    'feedback': 'customer-feedback'
  }
};

/**
 * Generates a JIRA issue template from an opportunity using LLM
 */
export async function generateJiraIssue(
  opportunity: Opportunity | ScoredOpportunity,
  signals: Signal[],
  config: Partial<JiraGenerationConfig> = {},
  llmProvider?: LLMProvider
): Promise<JiraIssueTemplate> {
  const startTime = Date.now();
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const provider = llmProvider || createLLMProviderFromEnv();

  logger.info('Starting JIRA issue generation', {
    stage: 'jira_generation',
    status: 'start',
    opportunity_id: opportunity.id,
    opportunity_title: opportunity.title,
    signal_count: signals.length,
    config: finalConfig
  });

  // Prepare context for LLM
  const context = prepareIssueContext(opportunity, signals, finalConfig);

  logger.debug('JIRA context prepared', {
    stage: 'jira_generation',
    status: 'context_prepared',
    opportunity_id: opportunity.id,
    customers: context.customers,
    customer_count: context.customers.length,
    themes: context.themes,
    theme_count: context.themes.length,
    signal_types: context.signalTypes,
    signal_types_count: context.signalTypes.length,
    sample_signals_count: context.signalSummaries.length,
    total_signals: context.totalSignals,
    impact_score: context.impactScore,
    confidence_score: context.confidenceScore
  });

  // Generate issue using LLM
  const prompt = buildJiraPrompt(context);

  logger.debug('Sending prompt to LLM for JIRA generation', {
    stage: 'jira_generation',
    status: 'llm_request',
    opportunity_id: opportunity.id,
    prompt_length: prompt.length,
    prompt_preview: prompt.substring(0, 200)
  });

  let llmResponse: string;
  let llmDuration: number;

  try {
    const llmStartTime = Date.now();
    llmResponse = await provider(prompt);
    llmDuration = Date.now() - llmStartTime;

    logger.info('LLM response received', {
      stage: 'jira_generation',
      status: 'llm_response',
      opportunity_id: opportunity.id,
      response_length: llmResponse.length,
      duration_ms: llmDuration,
      response_preview: llmResponse.substring(0, 200)
    });
  } catch (error: any) {
    logger.error('LLM request failed for JIRA generation', {
      stage: 'jira_generation',
      status: 'llm_error',
      opportunity_id: opportunity.id,
      error: error.message,
      stack: error.stack,
      duration_ms: Date.now() - startTime
    });
    throw new Error(`JIRA generation LLM request failed: ${error.message}`);
  }

  // Parse and validate response
  const parsed = parseJiraResponse(llmResponse, context);

  logger.debug('JIRA response parsed', {
    stage: 'jira_generation',
    status: 'parsed',
    opportunity_id: opportunity.id,
    summary: parsed.summary,
    issue_type: parsed.issueType,
    estimated_complexity: parsed.estimatedComplexity,
    customer_impact: parsed.customerImpact,
    acceptance_criteria_count: parsed.acceptanceCriteria?.length
  });

  // Enhance with metadata
  const enhanced = enhanceWithMetadata(parsed, opportunity, signals, finalConfig, context);
  await applySignalCategoryLabel(enhanced, signals);
  enhanced.rawLLMResponse = llmResponse;

  const totalDuration = Date.now() - startTime;

  logger.info('JIRA issue generated successfully', {
    stage: 'jira_generation',
    status: 'success',
    opportunity_id: opportunity.id,
    summary: enhanced.summary,
    issue_type: enhanced.issueType,
    priority: enhanced.priority,
    labels: enhanced.labels,
    components: enhanced.components,
    duration_ms: totalDuration,
    llm_duration_ms: llmDuration
  });

  return enhanced;
}

/**
 * Prepares context object for LLM prompt
 */
interface IssueContext {
  opportunityTitle: string;
  opportunityDescription: string;
  signalSummaries: string[];
  customers: string[];
  themes: string[];
  signalTypes: string[];
  sampleContent: string[];
  impactScore?: number;
  confidenceScore?: number;
  totalSignals: number;
}

function prepareIssueContext(
  opportunity: Opportunity | ScoredOpportunity,
  signals: Signal[],
  config: JiraGenerationConfig
): IssueContext {
  const maxSignals = config.maxSignalsToInclude || 10;
  const selectedSignals = signals.slice(0, maxSignals);
  
  // Extract unique customers
  const customers = new Set<string>();
  signals.forEach(s => {
    const metaCustomers = s.metadata?.customers as string[] || [];
    metaCustomers.forEach(c => customers.add(c));
    if (s.metadata?.customerName) {
      customers.add(s.metadata.customerName as string);
    }
  });
  
  // Extract themes
  const themes = new Set<string>();
  signals.forEach(s => {
    const metaThemes = s.metadata?.themes as string[] || [];
    metaThemes.forEach(t => themes.add(t));
  });
  
  // Get signal types
  const signalTypes = [...new Set(signals.map(s => s.signal_type))];
  
  // Sample content for context
  const sampleContent = selectedSignals
    .map(s => s.content.substring(0, 300))
    .filter(c => c.length > 50);
  
  // Get scores if available
  const scored = opportunity as ScoredOpportunity;
  
  return {
    opportunityTitle: opportunity.title,
    opportunityDescription: opportunity.description,
    signalSummaries: selectedSignals.map(s => 
      `[${s.signal_type}] ${s.content.substring(0, 200)}...`
    ),
    customers: Array.from(customers),
    themes: Array.from(themes),
    signalTypes,
    sampleContent,
    impactScore: scored.roadmapScore?.impactScore,
    confidenceScore: scored.roadmapScore?.confidenceScore,
    totalSignals: signals.length
  };
}

async function applySignalCategoryLabel(issue: JiraIssueTemplate, signals: Signal[]): Promise<void> {
  if (signals.length === 0) return;
  const pool = getDbPool();
  const signalIds = signals.map((signal) => signal.id);
  const result = await pool.query(
    `
      SELECT extraction->>'signal_category' AS signal_category
      FROM signal_extractions
      WHERE signal_id = ANY($1)
    `,
    [signalIds]
  );
  const counts = new Map<string, number>();
  result.rows.forEach((row) => {
    const category = row.signal_category;
    if (!category) return;
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  const community = counts.get('community_forum_ux') || 0;
  const product = counts.get('product_issue') || 0;
  if (community === 0 && product === 0) return;
  issue.labels = issue.labels.filter(
    (label) => label !== 'CommunityForumFixRequired' && label !== 'ProductFixRequired'
  );
  issue.labels.push(community >= product ? 'CommunityForumFixRequired' : 'ProductFixRequired');
}

/**
 * Builds the LLM prompt for JIRA issue generation
 */
function buildJiraPrompt(context: IssueContext): string {
  logger.trace('Building JIRA prompt', {
    stage: 'jira_generation',
    context_summary: {
      opportunity_title: context.opportunityTitle,
      customer_count: context.customers.length,
      theme_count: context.themes.length,
      signal_count: context.totalSignals,
      sample_signals_count: context.signalSummaries.length
    }
  });

  const prompt = `You are a Product Manager generating a JIRA issue from customer signals.
Create a well-structured issue that captures the customer need clearly.

OPPORTUNITY:
Title: ${context.opportunityTitle}
Description: ${context.opportunityDescription}
Total Signals: ${context.totalSignals}

CUSTOMERS AFFECTED:
${context.customers.length > 0 ? context.customers.join(', ') : 'Unknown'}

THEMES:
${context.themes.length > 0 ? context.themes.join(', ') : 'General feedback'}

SIGNAL TYPES:
${context.signalTypes.join(', ')}

SAMPLE SIGNALS (${context.signalSummaries.length} of ${context.totalSignals}):
${context.signalSummaries.slice(0, 5).join('\n\n')}

Return a JSON object with these exact fields:
{
  "summary": "Clear, action-oriented title (max 100 chars)",
  "issueType": "Story|Bug|Task|Epic|Feature",
  "description": "Detailed description with context (use markdown)",
  "acceptanceCriteria": ["AC1", "AC2", "AC3"],
  "technicalNotes": "Any technical considerations",
  "estimatedComplexity": "XS|S|M|L|XL",
  "customerImpact": "Critical|High|Medium|Low"
}

Guidelines:
- Summary should be action-oriented (e.g., "Enable PDF export for reports")
- Choose issueType based on signal types (issues=Bug, feature_requests=Story/Feature)
- Description should explain WHY this matters and WHAT customers need
- Include 3-5 specific, testable acceptance criteria
- Technical notes should mention any constraints or dependencies
- Estimate complexity based on scope indicated by signals

JSON response:`;

  logger.trace('JIRA prompt constructed', {
    stage: 'jira_generation',
    prompt_length: prompt.length,
    full_prompt: prompt
  });

  return prompt;
}

/**
 * Parses the LLM response into a partial JIRA template
 */
function parseJiraResponse(
  response: string,
  context: IssueContext
): Partial<JiraIssueTemplate> {
  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    logger.debug('JIRA response parsed successfully', {
      stage: 'jira_generation',
      summary: parsed.summary,
      issue_type: parsed.issueType,
      customer_impact: parsed.customerImpact
    });

    return {
      summary: sanitizeSummary(parsed.summary || context.opportunityTitle),
      issueType: validateIssueType(parsed.issueType),
      description: parsed.description || context.opportunityDescription,
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria)
        ? parsed.acceptanceCriteria
        : ['Define acceptance criteria'],
      technicalNotes: parsed.technicalNotes || '',
      estimatedComplexity: validateComplexity(parsed.estimatedComplexity),
      customerImpact: validateCustomerImpact(parsed.customerImpact)
    };
  } catch (error: any) {
    logger.warn('Failed to parse JIRA LLM response, using fallback template', {
      stage: 'jira_generation',
      status: 'parse_failure',
      error: error.message,
      response_preview: response.substring(0, 200),
      response_length: response.length,
      fallback_used: true,
      opportunity_title: context.opportunityTitle
    });

    // Fallback to basic template
    return {
      summary: sanitizeSummary(context.opportunityTitle),
      issueType: inferIssueType(context.signalTypes),
      description: buildFallbackDescription(context),
      acceptanceCriteria: ['Define specific acceptance criteria'],
      technicalNotes: '',
      estimatedComplexity: 'M',
      customerImpact: 'Medium'
    };
  }
}

/**
 * Sanitizes summary to meet JIRA constraints
 */
function sanitizeSummary(summary: string): string {
  return summary
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 255);
}

/**
 * Validates and normalizes issue type
 */
function validateIssueType(type: string): JiraIssueTemplate['issueType'] {
  const valid = ['Story', 'Bug', 'Task', 'Epic', 'Feature'];
  const normalized = type?.charAt(0).toUpperCase() + type?.slice(1).toLowerCase();
  return valid.includes(normalized) ? normalized as JiraIssueTemplate['issueType'] : 'Story';
}

/**
 * Validates complexity
 */
function validateComplexity(complexity: string): JiraIssueTemplate['estimatedComplexity'] {
  const valid = ['XS', 'S', 'M', 'L', 'XL'];
  return valid.includes(complexity?.toUpperCase()) 
    ? complexity.toUpperCase() as JiraIssueTemplate['estimatedComplexity'] 
    : 'M';
}

/**
 * Validates customer impact
 */
function validateCustomerImpact(impact: string): JiraIssueTemplate['customerImpact'] {
  const valid = ['Critical', 'High', 'Medium', 'Low'];
  const normalized = impact?.charAt(0).toUpperCase() + impact?.slice(1).toLowerCase();
  return valid.includes(normalized) ? normalized as JiraIssueTemplate['customerImpact'] : 'Medium';
}

/**
 * Infers issue type from signal types
 */
function inferIssueType(signalTypes: string[]): JiraIssueTemplate['issueType'] {
  if (signalTypes.includes('issue')) return 'Bug';
  if (signalTypes.includes('feature_request')) return 'Story';
  if (signalTypes.includes('pain_point')) return 'Task';
  return 'Story';
}

/**
 * Builds a fallback description when LLM parsing fails
 */
function buildFallbackDescription(context: IssueContext): string {
  return `## Background
This issue was identified from ${context.totalSignals} customer signal(s).

## Customers Affected
${context.customers.length > 0 ? context.customers.join(', ') : 'Various customers'}

## Themes
${context.themes.length > 0 ? context.themes.join(', ') : 'General'}

## Original Request
${context.opportunityDescription}

## Sample Feedback
${context.sampleContent.slice(0, 3).map(c => `> ${c.substring(0, 200)}...`).join('\n\n')}
`;
}

/**
 * Enhances parsed template with metadata
 */
function enhanceWithMetadata(
  partial: Partial<JiraIssueTemplate>,
  opportunity: Opportunity | ScoredOpportunity,
  signals: Signal[],
  config: JiraGenerationConfig,
  context: IssueContext
): JiraIssueTemplate {
  const scored = opportunity as ScoredOpportunity;
  
  // Calculate priority from impact score
  let priority: JiraIssueTemplate['priority'] = 'Medium';
  if (scored.roadmapScore?.impactScore) {
    if (scored.roadmapScore.impactScore >= 70) priority = config.priorityMapping?.highImpact || 'High';
    else if (scored.roadmapScore.impactScore >= 40) priority = config.priorityMapping?.mediumImpact || 'Medium';
    else priority = config.priorityMapping?.lowImpact || 'Low';
  }
  
  // Generate labels
  const labels: string[] = [];
  context.signalTypes.forEach(type => {
    const label = config.signalTypeToLabel?.[type];
    if (label) labels.push(label);
  });
  labels.push('customer-signal');
  if (signals.length >= 3) labels.push('validated');
  if (scored.roadmapScore?.urgencyScore && scored.roadmapScore.urgencyScore >= 70) {
    labels.push('trending');
  }
  
  // Generate components from themes
  const components = context.themes
    .map(theme => config.themeToComponent?.[theme] || theme.split('-')[0])
    .filter((v, i, a) => a.indexOf(v) === i) // unique
    .slice(0, 5);
  
  // Build enhanced description with markdown
  const enhancedDescription = `${partial.description}

---

## Customer Evidence
- **Affected Customers**: ${context.customers.join(', ') || 'Various'}
- **Total Signals**: ${context.totalSignals}
- **Signal Types**: ${context.signalTypes.join(', ')}

## Scoring
${scored.roadmapScore ? `
- **Impact Score**: ${scored.roadmapScore.impactScore}/100
- **Confidence Score**: ${scored.roadmapScore.confidenceScore}/100
- **Urgency Score**: ${scored.roadmapScore.urgencyScore}/100
` : '- Scoring data not available'}

## Technical Notes
${partial.technicalNotes || 'No specific technical notes.'}

---
*Generated from opportunity: ${opportunity.id}*
`;
  
  return {
    summary: partial.summary || context.opportunityTitle,
    issueType: partial.issueType || 'Story',
    priority,
    description: enhancedDescription,
    labels: [...new Set(labels)],
    components,
    acceptanceCriteria: partial.acceptanceCriteria || [],
    affectedCustomers: context.customers,
    customerImpact: partial.customerImpact || 'Medium',
    technicalNotes: partial.technicalNotes || '',
    estimatedComplexity: partial.estimatedComplexity || 'M',
    sourceOpportunityId: opportunity.id,
    sourceSignalIds: signals.map(s => s.id),
    generatedAt: new Date(),
    confidenceScore: scored.roadmapScore?.confidenceScore || 50
  };
}

/**
 * Generates JIRA issues for top opportunities
 */
export async function generateJiraIssuesForTopOpportunities(
  limit: number = 10,
  config: Partial<JiraGenerationConfig> = {},
  queryOptions: OpportunityQueryOptions = {}
): Promise<JiraIssueTemplate[]> {
  const startTime = Date.now();
  const llmProvider = createLLMProviderFromEnv();
  const opportunities = await getOpportunitiesWithScores({}, queryOptions);
  
  // Sort by overall score and take top N
  const topOpportunities = opportunities
    .sort((a, b) => b.roadmapScore.overallScore - a.roadmapScore.overallScore)
    .slice(0, limit);
  
  const issues: JiraIssueTemplate[] = [];
  let successCount = 0;
  let failureCount = 0;
  const total = topOpportunities.length;

  logger.info('Starting batch JIRA generation for top opportunities', {
    stage: 'jira_generation',
    status: 'start',
    requested: limit,
    selected: total,
    queryOptions
  });

  for (let idx = 0; idx < topOpportunities.length; idx++) {
    const opp = topOpportunities[idx];
    try {
      const issue = await generateJiraIssue(opp, opp.signals, config, llmProvider);
      issues.push(issue);
      successCount += 1;
    } catch (error: any) {
      failureCount += 1;
      logger.warn('Failed to generate JIRA issue for opportunity', { 
        stage: 'jira_generation',
        status: 'item_failed',
        opportunityId: opp.id, 
        error: error.message 
      });
    }

    const processed = idx + 1;
    const elapsedMs = Date.now() - startTime;
    const ratePerSec = elapsedMs > 0 ? processed / (elapsedMs / 1000) : 0;
    const remaining = Math.max(0, total - processed);
    const etaSeconds = ratePerSec > 0 ? Math.round(remaining / ratePerSec) : null;
    const progressPct = total > 0 ? ((processed / total) * 100).toFixed(1) : '100.0';

    logger.info('JIRA batch generation progress', {
      stage: 'jira_generation',
      status: 'in_progress',
      processed,
      total,
      progress_pct: progressPct,
      success_count: successCount,
      failure_count: failureCount,
      elapsed_ms: elapsedMs,
      rate_per_sec: ratePerSec.toFixed(2),
      eta_seconds: etaSeconds === null ? 'N/A' : String(etaSeconds)
    });
  }
  
  const totalElapsedMs = Date.now() - startTime;
  const throughputPerSec = totalElapsedMs > 0 ? total / (totalElapsedMs / 1000) : 0;
  logger.info('Generated JIRA issues for top opportunities', {
    stage: 'jira_generation',
    status: 'success',
    requested: limit,
    selected: total,
    generated: issues.length,
    success_count: successCount,
    failure_count: failureCount,
    elapsed_ms: totalElapsedMs,
    throughput_per_sec: throughputPerSec.toFixed(2)
  });
  
  return issues;
}

/**
 * Generates JIRA issues from signal extractions directly (without opportunities)
 */
export async function generateJiraIssuesFromExtractions(
  minSignals: number = 3,
  limit: number = 10
): Promise<JiraIssueTemplate[]> {
  const pool = getDbPool();
  const llmProvider = createLLMProviderFromEnv();
  
  // Get issues with multiple signals
  const result = await pool.query(`
    SELECT 
      e.entity_id as issue_id,
      i.title,
      i.category,
      i.severity,
      COUNT(DISTINCT se.signal_id) as signal_count,
      ARRAY_AGG(DISTINCT se.signal_id) as signal_ids
    FROM signal_entities se
    JOIN issues i ON i.id = se.entity_id
    JOIN signal_entities e ON e.signal_id = se.signal_id AND e.entity_type = 'issue'
    WHERE se.entity_type = 'issue'
    GROUP BY e.entity_id, i.title, i.category, i.severity
    HAVING COUNT(DISTINCT se.signal_id) >= $1
    ORDER BY COUNT(DISTINCT se.signal_id) DESC
    LIMIT $2
  `, [minSignals, limit]);
  
  if (result.rows.length === 0) {
    return [];
  }
  
  const issues: JiraIssueTemplate[] = [];
  
  for (const row of result.rows) {
    try {
      // Get signals for this issue
      const signalsResult = await pool.query(`
        SELECT s.* FROM signals s
        WHERE s.id = ANY($1)
      `, [row.signal_ids]);
      
      const signals: Signal[] = signalsResult.rows.map(r => ({
        ...r,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
        created_at: new Date(r.created_at)
      }));
      
      // Create pseudo-opportunity for generation
      const pseudoOpp: Opportunity = {
        id: row.issue_id,
        title: row.title || 'Issue from customer signals',
        description: `Category: ${row.category || 'Unknown'}, Severity: ${row.severity || 'Unknown'}`,
        status: 'new',
        created_at: new Date()
      };
      
      const jiraIssue = await generateJiraIssue(pseudoOpp, signals, {}, llmProvider);
      issues.push(jiraIssue);
    } catch (error: any) {
      logger.warn('Failed to generate JIRA issue from extraction', {
        issueId: row.issue_id,
        error: error.message
      });
    }
  }
  
  return issues;
}

/**
 * Stores generated JIRA issue templates
 */
export async function storeJiraIssueTemplate(issue: JiraIssueTemplate): Promise<string> {
  const pool = getDbPool();
  
  // First ensure the table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jira_issue_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      opportunity_id TEXT,
      summary TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      description TEXT,
      labels JSONB,
      components JSONB,
      acceptance_criteria JSONB,
      affected_customers JSONB,
      customer_impact TEXT,
      technical_notes TEXT,
      estimated_complexity TEXT,
      confidence_score NUMERIC,
      signal_ids JSONB,
      raw_llm_response TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      exported_at TIMESTAMP
    )
  `);

  const existing = await pool.query(
    `SELECT id FROM jira_issue_templates WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [issue.sourceOpportunityId]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }
  
  const result = await pool.query(`
    INSERT INTO jira_issue_templates (
      opportunity_id, summary, issue_type, priority, description,
      labels, components, acceptance_criteria, affected_customers,
      customer_impact, technical_notes, estimated_complexity,
      confidence_score, signal_ids, raw_llm_response
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING id
  `, [
    issue.sourceOpportunityId,
    issue.summary,
    issue.issueType,
    issue.priority,
    issue.description,
    JSON.stringify(issue.labels),
    JSON.stringify(issue.components),
    JSON.stringify(issue.acceptanceCriteria),
    JSON.stringify(issue.affectedCustomers),
    issue.customerImpact,
    issue.technicalNotes,
    issue.estimatedComplexity,
    issue.confidenceScore,
    JSON.stringify(issue.sourceSignalIds),
    issue.rawLLMResponse
  ]);
  
  return result.rows[0].id;
}

/**
 * Gets all stored JIRA issue templates
 */
export async function getStoredJiraTemplates(): Promise<Array<JiraIssueTemplate & { id: string }>> {
  const pool = getDbPool();
  
  const result = await pool.query(`
    SELECT * FROM jira_issue_templates
    ORDER BY created_at DESC
  `);
  
  return result.rows.map(row => ({
    id: row.id,
    summary: row.summary,
    issueType: row.issue_type,
    priority: row.priority,
    description: row.description,
    labels: row.labels || [],
    components: row.components || [],
    acceptanceCriteria: row.acceptance_criteria || [],
    affectedCustomers: row.affected_customers || [],
    customerImpact: row.customer_impact,
    technicalNotes: row.technical_notes,
    estimatedComplexity: row.estimated_complexity,
    sourceOpportunityId: row.opportunity_id,
    sourceSignalIds: row.signal_ids || [],
    generatedAt: new Date(row.created_at),
    confidenceScore: parseFloat(row.confidence_score),
    rawLLMResponse: row.raw_llm_response
  }));
}

/**
 * Exports JIRA templates to JSON format for import
 */
export function exportJiraTemplatesToJson(templates: JiraIssueTemplate[]): string {
  const exportData = templates.map(t => ({
    fields: {
      summary: t.summary,
      issuetype: { name: t.issueType },
      priority: { name: t.priority },
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: t.description }]
          }
        ]
      },
      labels: t.labels,
      components: t.components.map(c => ({ name: c }))
    },
    customFields: {
      acceptanceCriteria: t.acceptanceCriteria.join('\n'),
      customerImpact: t.customerImpact,
      estimatedComplexity: t.estimatedComplexity,
      affectedCustomers: t.affectedCustomers.join(', ')
    },
    metadata: {
      sourceOpportunityId: t.sourceOpportunityId,
      generatedAt: t.generatedAt.toISOString(),
      confidenceScore: t.confidenceScore
    }
  }));
  
  return JSON.stringify(exportData, null, 2);
}
