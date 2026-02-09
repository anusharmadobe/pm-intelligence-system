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
  getOpportunitiesWithScores
} from './opportunity_service';
import { getThemePath } from '../config/theme_dictionary';
import { logger } from '../utils/logger';

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
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const provider = llmProvider || createLLMProviderFromEnv();
  
  // Prepare context for LLM
  const context = prepareIssueContext(opportunity, signals, finalConfig);
  
  // Generate issue using LLM
  const prompt = buildJiraPrompt(context);
  const llmResponse = await provider(prompt);
  
  // Parse and validate response
  const parsed = parseJiraResponse(llmResponse, context);
  
  // Enhance with metadata
  const enhanced = enhanceWithMetadata(parsed, opportunity, signals, finalConfig, context);
  enhanced.rawLLMResponse = llmResponse;
  
  logger.info('JIRA issue generated', {
    opportunityId: opportunity.id,
    summary: enhanced.summary,
    issueType: enhanced.issueType,
    priority: enhanced.priority
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

/**
 * Builds the LLM prompt for JIRA issue generation
 */
function buildJiraPrompt(context: IssueContext): string {
  return `You are a Product Manager generating a JIRA issue from customer signals.
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
    logger.warn('Failed to parse JIRA LLM response, using fallback', { error: error.message });
    
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
  config: Partial<JiraGenerationConfig> = {}
): Promise<JiraIssueTemplate[]> {
  const llmProvider = createLLMProviderFromEnv();
  const opportunities = await getOpportunitiesWithScores();
  
  // Sort by overall score and take top N
  const topOpportunities = opportunities
    .sort((a, b) => b.roadmapScore.overallScore - a.roadmapScore.overallScore)
    .slice(0, limit);
  
  const issues: JiraIssueTemplate[] = [];
  
  for (const opp of topOpportunities) {
    try {
      const issue = await generateJiraIssue(opp, opp.signals, config, llmProvider);
      issues.push(issue);
    } catch (error: any) {
      logger.warn('Failed to generate JIRA issue for opportunity', { 
        opportunityId: opp.id, 
        error: error.message 
      });
    }
  }
  
  logger.info('Generated JIRA issues for top opportunities', {
    requested: limit,
    generated: issues.length
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
