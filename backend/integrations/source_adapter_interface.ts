/**
 * Source Adapter Interface
 * 
 * Defines the contract for integrating external data sources into the PM Intelligence System.
 * All source adapters (Slack, Gong, Zendesk, etc.) should implement this interface.
 * 
 * Design Principles:
 * 1. Source-agnostic: Core system doesn't care where signals come from
 * 2. Async streaming: Support both batch and streaming ingestion
 * 3. Metadata preservation: Capture source-specific context
 * 4. Error resilience: Graceful handling of partial failures
 * 5. Rate limiting: Respect source API limits
 */

import { RawSignal, Signal } from '../processing/signal_extractor';

// ============================================================================
// CORE INTERFACES
// ============================================================================

/**
 * Source types supported by the system
 */
export type SourceType = 
  | 'slack'
  | 'gong'
  | 'zendesk'
  | 'intercom'
  | 'hubspot'
  | 'salesforce'
  | 'email'
  | 'survey'
  | 'custom';

/**
 * Configuration for a source adapter
 */
export interface SourceAdapterConfig {
  /** Unique identifier for this source instance */
  sourceId: string;
  
  /** Type of source */
  sourceType: SourceType;
  
  /** Human-readable name */
  displayName: string;
  
  /** Whether the source is currently active */
  isActive: boolean;
  
  /** Authentication configuration (type depends on source) */
  auth: SourceAuthConfig;
  
  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig;
  
  /** Default channel/category weight for this source */
  defaultWeight: number;
  
  /** Metadata about the source */
  metadata?: Record<string, unknown>;
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Last modified timestamp */
  updatedAt: Date;
}

/**
 * Authentication configuration (varies by source)
 */
export type SourceAuthConfig = 
  | OAuthConfig
  | ApiKeyConfig
  | BasicAuthConfig
  | WebhookConfig;

export interface OAuthConfig {
  type: 'oauth';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

export interface ApiKeyConfig {
  type: 'api_key';
  apiKey: string;
  apiKeyHeader?: string;
}

export interface BasicAuthConfig {
  type: 'basic';
  username: string;
  password: string;
}

export interface WebhookConfig {
  type: 'webhook';
  webhookSecret?: string;
  verificationToken?: string;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per time window */
  maxRequests: number;
  
  /** Time window in milliseconds */
  windowMs: number;
  
  /** Delay between requests in milliseconds */
  delayMs?: number;
  
  /** Maximum concurrent requests */
  maxConcurrent?: number;
}

// ============================================================================
// INGESTION INTERFACES
// ============================================================================

/**
 * Options for ingestion operations
 */
export interface IngestionOptions {
  /** Maximum items to fetch per request */
  batchSize?: number;
  
  /** Maximum total items to ingest */
  limit?: number;
  
  /** Start date for time-based filtering */
  startDate?: Date;
  
  /** End date for time-based filtering */
  endDate?: Date;
  
  /** Specific channels/categories to include */
  includeChannels?: string[];
  
  /** Channels/categories to exclude */
  excludeChannels?: string[];
  
  /** Whether to auto-register new channels */
  autoRegisterChannels?: boolean;
  
  /** Whether to skip already-ingested items */
  skipDuplicates?: boolean;
  
  /** Custom filters (source-specific) */
  filters?: Record<string, unknown>;
}

/**
 * Result of an ingestion operation
 */
export interface IngestionResult {
  /** Source identifier */
  sourceId: string;
  
  /** Whether the operation succeeded */
  success: boolean;
  
  /** Number of items fetched from source */
  fetchedCount: number;
  
  /** Number of items successfully ingested */
  ingestedCount: number;
  
  /** Number of items skipped (duplicates, filtered, etc.) */
  skippedCount: number;
  
  /** Number of items that failed */
  failedCount: number;
  
  /** Error messages if any */
  errors: IngestionError[];
  
  /** Duration in milliseconds */
  durationMs: number;
  
  /** Timestamp of ingestion */
  timestamp: Date;
  
  /** Cursor for pagination (if supported) */
  nextCursor?: string;
  
  /** Whether there are more items to fetch */
  hasMore: boolean;
}

/**
 * Ingestion error details
 */
export interface IngestionError {
  /** Item identifier if available */
  itemId?: string;
  
  /** Error code */
  code: string;
  
  /** Human-readable message */
  message: string;
  
  /** Whether the error is retryable */
  retryable: boolean;
  
  /** Original error if available */
  originalError?: unknown;
}

// ============================================================================
// NORMALIZATION INTERFACES
// ============================================================================

/**
 * Source-specific raw item (before normalization)
 */
export interface SourceItem {
  /** Unique identifier in the source system */
  sourceItemId: string;
  
  /** Type of item in source system */
  sourceItemType: string;
  
  /** Raw data from source API */
  rawData: Record<string, unknown>;
  
  /** Timestamp from source */
  timestamp: Date;
  
  /** Author/sender information */
  author?: {
    id: string;
    name?: string;
    email?: string;
  };
  
  /** Channel/category in source */
  channel?: {
    id: string;
    name?: string;
    type?: string;
  };
  
  /** Associated customer if known */
  customer?: {
    id?: string;
    name?: string;
    email?: string;
    tier?: string;
  };
}

/**
 * Normalizer function type
 */
export type ItemNormalizer<T extends SourceItem = SourceItem> = (
  item: T,
  config: SourceAdapterConfig
) => RawSignal;

// ============================================================================
// ADAPTER INTERFACE
// ============================================================================

/**
 * Core source adapter interface
 * All source adapters must implement this interface
 */
export interface SourceAdapter {
  /** Get adapter configuration */
  getConfig(): SourceAdapterConfig;
  
  /** Test connection to the source */
  testConnection(): Promise<ConnectionTestResult>;
  
  /** Fetch items from the source */
  fetchItems(options?: IngestionOptions): Promise<FetchResult>;
  
  /** Ingest items into the system */
  ingest(options?: IngestionOptions): Promise<IngestionResult>;
  
  /** Get available channels/categories */
  getChannels(): Promise<SourceChannel[]>;
  
  /** Handle webhook payloads (for real-time sources) */
  handleWebhook?(payload: unknown): Promise<Signal[]>;
  
  /** Get adapter health status */
  getHealth(): Promise<AdapterHealth>;
  
  /** Refresh authentication (if needed) */
  refreshAuth?(): Promise<void>;
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

/**
 * Result of fetching items (before ingestion)
 */
export interface FetchResult {
  items: SourceItem[];
  nextCursor?: string;
  hasMore: boolean;
  totalAvailable?: number;
}

/**
 * Channel/category information from source
 */
export interface SourceChannel {
  id: string;
  name: string;
  type?: string;
  memberCount?: number;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Adapter health status
 */
export interface AdapterHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastSuccessfulIngestion?: Date;
  lastError?: string;
  metrics: {
    totalIngested: number;
    lastHourIngested: number;
    errorRate: number;
    avgLatencyMs: number;
  };
}

// ============================================================================
// ABSTRACT BASE ADAPTER
// ============================================================================

/**
 * Abstract base class for source adapters
 * Provides common functionality and enforces interface
 */
export abstract class BaseSourceAdapter implements SourceAdapter {
  protected config: SourceAdapterConfig;
  protected normalizer: ItemNormalizer;
  
  constructor(config: SourceAdapterConfig, normalizer: ItemNormalizer) {
    this.config = config;
    this.normalizer = normalizer;
  }
  
  getConfig(): SourceAdapterConfig {
    return this.config;
  }
  
  abstract testConnection(): Promise<ConnectionTestResult>;
  abstract fetchItems(options?: IngestionOptions): Promise<FetchResult>;
  abstract getChannels(): Promise<SourceChannel[]>;
  
  async ingest(options?: IngestionOptions): Promise<IngestionResult> {
    const startTime = Date.now();
    const errors: IngestionError[] = [];
    let fetchedCount = 0;
    let ingestedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let nextCursor: string | undefined;
    let hasMore = false;
    
    try {
      // Fetch items
      const fetchResult = await this.fetchItems(options);
      fetchedCount = fetchResult.items.length;
      nextCursor = fetchResult.nextCursor;
      hasMore = fetchResult.hasMore;
      
      // Process each item
      const { ingestSignal } = await import('../processing/signal_extractor');
      
      for (const item of fetchResult.items) {
        try {
          // Normalize to RawSignal
          const rawSignal = this.normalizer(item, this.config);
          
          // Check for duplicates if requested
          if (options?.skipDuplicates) {
            const isDuplicate = await this.checkDuplicate(rawSignal);
            if (isDuplicate) {
              skippedCount++;
              continue;
            }
          }
          
          // Ingest the signal
          await ingestSignal(rawSignal);
          ingestedCount++;
        } catch (itemError: any) {
          failedCount++;
          errors.push({
            itemId: item.sourceItemId,
            code: 'INGEST_FAILED',
            message: itemError.message,
            retryable: true,
            originalError: itemError
          });
        }
      }
    } catch (fetchError: any) {
      errors.push({
        code: 'FETCH_FAILED',
        message: fetchError.message,
        retryable: true,
        originalError: fetchError
      });
    }
    
    return {
      sourceId: this.config.sourceId,
      success: errors.length === 0,
      fetchedCount,
      ingestedCount,
      skippedCount,
      failedCount,
      errors,
      durationMs: Date.now() - startTime,
      timestamp: new Date(),
      nextCursor,
      hasMore
    };
  }
  
  async getHealth(): Promise<AdapterHealth> {
    // Default implementation - subclasses can override
    try {
      const connectionTest = await this.testConnection();
      return {
        status: connectionTest.success ? 'healthy' : 'unhealthy',
        lastError: connectionTest.success ? undefined : connectionTest.message,
        metrics: {
          totalIngested: 0,
          lastHourIngested: 0,
          errorRate: connectionTest.success ? 0 : 1,
          avgLatencyMs: connectionTest.latencyMs || 0
        }
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        lastError: error.message,
        metrics: {
          totalIngested: 0,
          lastHourIngested: 0,
          errorRate: 1,
          avgLatencyMs: 0
        }
      };
    }
  }
  
  /**
   * Check if a signal already exists (for deduplication)
   */
  protected async checkDuplicate(rawSignal: RawSignal): Promise<boolean> {
    const { getDbPool } = await import('../db/connection');
    const pool = getDbPool();
    
    // Check by external ID (source_ref)
    const sourceRef = rawSignal.id || rawSignal.metadata?.source_id;
    if (sourceRef) {
      const result = await pool.query(
        `SELECT id FROM signals WHERE source = $1 AND source_ref = $2 LIMIT 1`,
        [rawSignal.source, sourceRef]
      );
      return result.rows.length > 0;
    }
    
    return false;
  }
}

// ============================================================================
// ADAPTER REGISTRY
// ============================================================================

/**
 * Registry for managing source adapters
 */
export class SourceAdapterRegistry {
  private adapters: Map<string, SourceAdapter> = new Map();
  
  /**
   * Register an adapter
   */
  register(adapter: SourceAdapter): void {
    const config = adapter.getConfig();
    this.adapters.set(config.sourceId, adapter);
  }
  
  /**
   * Unregister an adapter
   */
  unregister(sourceId: string): boolean {
    return this.adapters.delete(sourceId);
  }
  
  /**
   * Get an adapter by ID
   */
  get(sourceId: string): SourceAdapter | undefined {
    return this.adapters.get(sourceId);
  }
  
  /**
   * Get all adapters
   */
  getAll(): SourceAdapter[] {
    return Array.from(this.adapters.values());
  }
  
  /**
   * Get adapters by type
   */
  getByType(sourceType: SourceType): SourceAdapter[] {
    return this.getAll().filter(
      adapter => adapter.getConfig().sourceType === sourceType
    );
  }
  
  /**
   * Get active adapters
   */
  getActive(): SourceAdapter[] {
    return this.getAll().filter(
      adapter => adapter.getConfig().isActive
    );
  }
  
  /**
   * Ingest from all active sources
   */
  async ingestAll(options?: IngestionOptions): Promise<IngestionResult[]> {
    const activeAdapters = this.getActive();
    const results = await Promise.allSettled(
      activeAdapters.map(adapter => adapter.ingest(options))
    );
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      
      // Return error result for failed adapters
      const config = activeAdapters[index].getConfig();
      return {
        sourceId: config.sourceId,
        success: false,
        fetchedCount: 0,
        ingestedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errors: [{
          code: 'ADAPTER_FAILED',
          message: result.reason?.message || 'Unknown error',
          retryable: true,
          originalError: result.reason
        }],
        durationMs: 0,
        timestamp: new Date(),
        hasMore: false
      };
    });
  }
  
  /**
   * Get health status of all adapters
   */
  async getHealthAll(): Promise<Map<string, AdapterHealth>> {
    const healthMap = new Map<string, AdapterHealth>();
    
    const results = await Promise.allSettled(
      this.getAll().map(async adapter => ({
        sourceId: adapter.getConfig().sourceId,
        health: await adapter.getHealth()
      }))
    );
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        healthMap.set(result.value.sourceId, result.value.health);
      }
    }
    
    return healthMap;
  }
}

// Singleton registry instance
export const adapterRegistry = new SourceAdapterRegistry();

// ============================================================================
// GONG ADAPTER SKELETON
// ============================================================================

/**
 * Gong-specific source item
 */
export interface GongCallItem extends SourceItem {
  sourceItemType: 'call';
  rawData: {
    callId: string;
    title?: string;
    duration: number;
    participants: Array<{
      name: string;
      email?: string;
      isExternal: boolean;
    }>;
    transcript?: Array<{
      speaker: string;
      text: string;
      startTime: number;
    }>;
    highlights?: Array<{
      type: string;
      text: string;
    }>;
    topics?: string[];
  };
}

/**
 * Gong adapter configuration
 */
export interface GongAdapterConfig extends SourceAdapterConfig {
  sourceType: 'gong';
  auth: OAuthConfig;
  settings: {
    includeTranscripts: boolean;
    includeHighlights: boolean;
    callTypes: string[];
  };
}

/**
 * Gong item normalizer
 */
export function normalizeGongCall(
  item: GongCallItem,
  config: SourceAdapterConfig
): RawSignal {
  const call = item.rawData;
  
  // Build content from transcript or title
  let content = call.title || '';
  if (call.transcript && call.transcript.length > 0) {
    content += '\n\n' + call.transcript
      .map(t => `${t.speaker}: ${t.text}`)
      .join('\n');
  }
  
  // Extract customer from external participants
  const externalParticipants = call.participants.filter(p => p.isExternal);
  const customer = externalParticipants[0]?.name;
  
  return {
    source: config.sourceType,
    id: call.callId,
    type: 'call_transcript',
    text: content,
    metadata: {
      call_id: call.callId,
      duration: call.duration,
      participants: call.participants,
      highlights: call.highlights,
      topics: call.topics,
      customer_name: customer,
      source_weight: config.defaultWeight,
      source_id: call.callId,
      source_timestamp: item.timestamp
    }
  };
}

// ============================================================================
// ZENDESK ADAPTER SKELETON
// ============================================================================

/**
 * Zendesk-specific source item
 */
export interface ZendeskTicketItem extends SourceItem {
  sourceItemType: 'ticket';
  rawData: {
    ticketId: number;
    subject: string;
    description: string;
    status: string;
    priority?: string;
    tags?: string[];
    comments: Array<{
      author: string;
      body: string;
      createdAt: Date;
      isPublic: boolean;
    }>;
    customFields?: Record<string, unknown>;
  };
}

/**
 * Zendesk adapter configuration
 */
export interface ZendeskAdapterConfig extends SourceAdapterConfig {
  sourceType: 'zendesk';
  auth: ApiKeyConfig;
  settings: {
    subdomain: string;
    includePrivateComments: boolean;
    ticketStatuses: string[];
  };
}

/**
 * Zendesk item normalizer
 */
export function normalizeZendeskTicket(
  item: ZendeskTicketItem,
  config: SourceAdapterConfig
): RawSignal {
  const ticket = item.rawData;
  
  // Build content from description and public comments
  let content = `${ticket.subject}\n\n${ticket.description}`;
  
  const publicComments = ticket.comments.filter(c => c.isPublic);
  if (publicComments.length > 0) {
    content += '\n\n--- Comments ---\n';
    content += publicComments
      .map(c => `${c.author}: ${c.body}`)
      .join('\n\n');
  }
  
  return {
    source: config.sourceType,
    id: `ticket-${ticket.ticketId}`,
    type: 'support_ticket',
    text: content,
    metadata: {
      ticket_id: ticket.ticketId,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      tags: ticket.tags,
      comment_count: ticket.comments.length,
      customer_email: item.customer?.email,
      customer_name: item.customer?.name,
      source_weight: config.defaultWeight,
      source_id: `ticket-${ticket.ticketId}`,
      source_timestamp: item.timestamp
    }
  };
}

// ============================================================================
// INTERCOM ADAPTER SKELETON
// ============================================================================

/**
 * Intercom-specific source item
 */
export interface IntercomConversationItem extends SourceItem {
  sourceItemType: 'conversation';
  rawData: {
    conversationId: string;
    state: string;
    source: {
      type: string;
      body: string;
    };
    conversationParts: Array<{
      partType: string;
      body: string;
      author: {
        type: string;
        name?: string;
      };
      createdAt: Date;
    }>;
    tags?: Array<{ name: string }>;
  };
}

/**
 * Intercom item normalizer
 */
export function normalizeIntercomConversation(
  item: IntercomConversationItem,
  config: SourceAdapterConfig
): RawSignal {
  const conversation = item.rawData;
  
  // Build content from initial message and conversation parts
  let content = conversation.source.body || '';
  
  if (conversation.conversationParts.length > 0) {
    content += '\n\n';
    content += conversation.conversationParts
      .filter(p => p.partType !== 'assignment')
      .map(p => `${p.author.name || p.author.type}: ${p.body}`)
      .join('\n\n');
  }
  
  return {
    source: config.sourceType,
    id: conversation.conversationId,
    type: 'chat_conversation',
    text: content,
    metadata: {
      conversation_id: conversation.conversationId,
      state: conversation.state,
      source_type: conversation.source.type,
      tags: conversation.tags?.map(t => t.name) || [],
      part_count: conversation.conversationParts.length,
      customer_name: item.customer?.name,
      source_weight: config.defaultWeight,
      source_id: conversation.conversationId,
      source_timestamp: item.timestamp
    }
  };
}
