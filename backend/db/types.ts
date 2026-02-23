/**
 * Database Type Definitions
 *
 * TypeScript interfaces for all PostgreSQL tables in the PM Intelligence System
 * These types ensure type safety and eliminate SELECT * queries
 */

// ===========================
// Core Signal Tables
// ===========================

export interface Signal {
  id: string;
  source: string;
  type: string;
  text: string;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface SignalExtraction {
  id: string;
  signal_id: string;
  extraction_type: string;
  extracted_data: Record<string, any>;
  status: 'pending' | 'completed' | 'failed';
  error_message: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface FailedSignalAttempt {
  id: string;
  signal_id: string;
  attempt_number: number;
  error_type: string;
  error_message: string;
  stack_trace: string | null;
  metadata: Record<string, any> | null;
  created_at: Date;
}

// ===========================
// Entity Registry Tables
// ===========================

export interface EntityRegistry {
  id: string;
  entity_type: 'customer' | 'feature' | 'issue' | 'theme';
  canonical_name: string;
  canonical_name_embedding: number[] | null;
  metadata: Record<string, any> | null;
  first_seen_at: Date;
  last_seen_at: Date;
  mention_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface EntityAlias {
  id: string;
  entity_id: string;
  alias: string;
  alias_type: 'acronym' | 'abbreviation' | 'misspelling' | 'variation' | 'synonym' | 'auto_detected';
  confidence: number;
  source: string | null;
  created_at: Date;
}

export interface EntityResolutionLog {
  id: string;
  signal_id: string;
  mention: string;
  entity_type: string;
  resolved_to_entity_id: string | null;
  resolution_result: 'alias_matched' | 'auto_merged' | 'human_review' | 'new_entity' | 'unresolved';
  confidence: number;
  match_method: string | null;
  match_details: Record<string, any> | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

export interface EntityMergeHistory {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  merge_reason: string;
  merged_by: string | null;
  confidence: number;
  rollback_data: Record<string, any> | null;
  created_at: Date;
}

export interface EntityNameEmbedding {
  entity_id: string;
  canonical_name: string;
  embedding: number[];
  provider: string;
  model: string;
  created_at: Date;
  updated_at: Date;
}

// ===========================
// Signal-Entity Relationships
// ===========================

export interface SignalEntity {
  signal_id: string;
  entity_id: string;
  entity_type: string;
  confidence: number;
  extraction_method: string;
  created_at: Date;
}

// ===========================
// Theme Hierarchy Tables
// ===========================

export interface ThemeHierarchy {
  id: string;
  name: string;
  parent_id: string | null;
  level: number;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SignalThemeHierarchy {
  signal_id: string;
  theme_id: string;
  confidence: number;
  assigned_by: string;
  created_at: Date;
}

// ===========================
// Opportunity Tables
// ===========================

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  signal_ids: string[];
  cluster_id: string | null;
  rice_score: number | null;
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  effort: number | null;
  status: 'detected' | 'validated' | 'prioritized' | 'implemented' | 'dismissed';
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

// ===========================
// Domain Entity Tables
// ===========================

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  tier: string | null;
  arr: number | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

export interface Feature {
  id: string;
  canonical_name: string;
  description: string | null;
  product_area: string | null;
  status: string | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

export interface Issue {
  id: string;
  title: string;
  description: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical' | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed' | null;
  jira_key: string | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

// ===========================
// Neo4j Sync Tables
// ===========================

export interface Neo4jSyncBacklog {
  id: string;
  operation: 'signal_sync' | 'entity_merge' | 'entity_split' | 'relationship_add';
  payload: Record<string, any>;
  status: 'pending' | 'processed' | 'failed';
  retry_count: number;
  error_message: string | null;
  created_at: Date;
  processed_at: Date | null;
}

// ===========================
// GraphRAG Tables
// ===========================

export interface GraphragCommunity {
  id: string;
  community_id: string;
  level: number;
  title: string;
  summary: string | null;
  signal_ids: string[];
  entity_ids: string[];
  keywords: string[];
  centrality_score: number | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}

// ===========================
// System & Monitoring Tables
// ===========================

export interface SystemMetric {
  id: string;
  metric_name: string;
  metric_value: number;
  labels: Record<string, any> | null;
  recorded_at: Date;
}

export interface SourceRegistry {
  id: string;
  source_type: string;
  source_id: string;
  source_name: string;
  configuration: Record<string, any> | null;
  last_sync_at: Date | null;
  sync_status: 'active' | 'paused' | 'failed' | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  user_id: string | null;
  changes: Record<string, any> | null;
  metadata: Record<string, any> | null;
  created_at: Date;
}

export interface FeedbackLog {
  id: string;
  feedback_type: string;
  system_output: string;
  user_correction: string | null;
  status: 'pending' | 'reviewed' | 'applied' | 'dismissed';
  reviewed_by: string | null;
  reviewed_at: Date | null;
  metadata: Record<string, any> | null;
  created_at: Date;
}

export interface AgentRegistry {
  id: string;
  agent_name: string;
  agent_type: string;
  configuration: Record<string, any> | null;
  status: 'active' | 'paused' | 'disabled';
  last_run_at: Date | null;
  next_run_at: Date | null;
  run_count: number;
  error_count: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface IdempotencyKey {
  key: string;
  resource_type: string;
  resource_id: string | null;
  status: 'processing' | 'completed' | 'failed';
  response_data: Record<string, any> | null;
  expires_at: Date;
  created_at: Date;
}

// ===========================
// Helper Types for Queries
// ===========================

/**
 * Utility type to get column names from a table interface
 */
export type ColumnNames<T> = Extract<keyof T, string>;

/**
 * Utility type to build SELECT clauses
 */
export type SelectColumns<T> = ColumnNames<T>[];

/**
 * Generates a SELECT clause from an array of column names
 */
export function buildSelectClause<T>(columns: SelectColumns<T>, tableName?: string): string {
  const prefix = tableName ? `${tableName}.` : '';
  return columns.map(col => `${prefix}${col}`).join(', ');
}

/**
 * Type-safe query builder helpers
 */
export const SignalColumns: ColumnNames<Signal>[] = [
  'id',
  'source',
  'type',
  'text',
  'metadata',
  'created_at',
  'updated_at'
];

export const SignalExtractionColumns: ColumnNames<SignalExtraction>[] = [
  'id',
  'signal_id',
  'extraction_type',
  'extracted_data',
  'status',
  'error_message',
  'llm_provider',
  'llm_model',
  'prompt_tokens',
  'completion_tokens',
  'created_at',
  'updated_at'
];

export const EntityRegistryColumns: ColumnNames<EntityRegistry>[] = [
  'id',
  'entity_type',
  'canonical_name',
  'canonical_name_embedding',
  'metadata',
  'first_seen_at',
  'last_seen_at',
  'mention_count',
  'created_at',
  'updated_at'
];

export const EntityResolutionLogColumns: ColumnNames<EntityResolutionLog>[] = [
  'id',
  'signal_id',
  'mention',
  'entity_type',
  'resolved_to_entity_id',
  'resolution_result',
  'confidence',
  'match_method',
  'match_details',
  'reviewed_by',
  'reviewed_at',
  'created_at'
];

export const OpportunityColumns: ColumnNames<Opportunity>[] = [
  'id',
  'title',
  'description',
  'signal_ids',
  'cluster_id',
  'rice_score',
  'reach',
  'impact',
  'confidence',
  'effort',
  'status',
  'metadata',
  'created_at',
  'updated_at'
];

export const Neo4jSyncBacklogColumns: ColumnNames<Neo4jSyncBacklog>[] = [
  'id',
  'operation',
  'payload',
  'status',
  'retry_count',
  'error_message',
  'created_at',
  'processed_at'
];

export const GraphragCommunityColumns: ColumnNames<GraphragCommunity>[] = [
  'id',
  'community_id',
  'level',
  'title',
  'summary',
  'signal_ids',
  'entity_ids',
  'keywords',
  'centrality_score',
  'metadata',
  'created_at',
  'updated_at'
];

export const SystemMetricColumns: ColumnNames<SystemMetric>[] = [
  'id',
  'metric_name',
  'metric_value',
  'labels',
  'recorded_at'
];

export const FeedbackLogColumns: ColumnNames<FeedbackLog>[] = [
  'id',
  'feedback_type',
  'system_output',
  'user_correction',
  'status',
  'reviewed_by',
  'reviewed_at',
  'metadata',
  'created_at'
];

export const AgentRegistryColumns: ColumnNames<AgentRegistry>[] = [
  'id',
  'agent_name',
  'agent_type',
  'configuration',
  'status',
  'last_run_at',
  'next_run_at',
  'run_count',
  'error_count',
  'last_error',
  'created_at',
  'updated_at'
];

/**
 * Example usage:
 *
 * Instead of:
 *   SELECT * FROM signals WHERE id = $1
 *
 * Use:
 *   SELECT ${buildSelectClause(SignalColumns)} FROM signals WHERE id = $1
 *
 * Or manually:
 *   SELECT id, source, type, text, created_at FROM signals WHERE id = $1
 */
