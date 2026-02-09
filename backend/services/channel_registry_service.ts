import { getDbPool } from '../db/connection';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';

/**
 * Channel category types for signal weighting and categorization
 */
export type ChannelCategory = 
  | 'customer_engagement' 
  | 'support' 
  | 'sales' 
  | 'engineering' 
  | 'general';

/**
 * Channel configuration interface
 */
export interface ChannelConfig {
  id?: string;
  channelId: string;
  channelName: string;
  category: ChannelCategory;
  weight: number;  // 0.5 to 2.0, affects signal scoring
  isActive: boolean;
  workspaceId?: string;
  description?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Default weights by channel category
 */
export const DEFAULT_CATEGORY_WEIGHTS: Record<ChannelCategory, number> = {
  customer_engagement: 1.5,
  support: 1.3,
  sales: 1.2,
  engineering: 1.0,
  general: 0.8
};

/**
 * Registers a new channel in the registry
 */
export async function registerChannel(config: Omit<ChannelConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const pool = getDbPool();
  const id = randomUUID();
  
  // Use category default weight if not specified
  const weight = config.weight ?? DEFAULT_CATEGORY_WEIGHTS[config.category] ?? 1.0;
  
  try {
    await pool.query(
      `INSERT INTO slack_channels (id, channel_id, channel_name, category, weight, is_active, workspace_id, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (channel_id) DO UPDATE SET
         channel_name = EXCLUDED.channel_name,
         category = EXCLUDED.category,
         weight = EXCLUDED.weight,
         is_active = EXCLUDED.is_active,
         workspace_id = EXCLUDED.workspace_id,
         description = EXCLUDED.description,
         metadata = EXCLUDED.metadata`,
      [
        id,
        config.channelId,
        config.channelName,
        config.category,
        weight,
        config.isActive ?? true,
        config.workspaceId || null,
        config.description || null,
        config.metadata ? JSON.stringify(config.metadata) : null
      ]
    );
    
    logger.info('Channel registered', { channelId: config.channelId, category: config.category, weight });
    return id;
  } catch (error: any) {
    logger.error('Failed to register channel', { error: error.message, channelId: config.channelId });
    throw error;
  }
}

/**
 * Gets all active channels from the registry
 */
export async function getActiveChannels(): Promise<ChannelConfig[]> {
  const pool = getDbPool();
  
  const result = await pool.query(
    `SELECT id, channel_id, channel_name, category, weight, is_active, workspace_id, description, metadata, created_at, updated_at
     FROM slack_channels
     WHERE is_active = TRUE
     ORDER BY category, channel_name`
  );
  
  return result.rows.map(mapRowToChannelConfig);
}

/**
 * Gets all channels (including inactive) from the registry
 */
export async function getAllChannels(): Promise<ChannelConfig[]> {
  const pool = getDbPool();
  
  const result = await pool.query(
    `SELECT id, channel_id, channel_name, category, weight, is_active, workspace_id, description, metadata, created_at, updated_at
     FROM slack_channels
     ORDER BY category, channel_name`
  );
  
  return result.rows.map(mapRowToChannelConfig);
}

/**
 * Gets the weight for a specific channel
 * Returns default weight (1.0) if channel not found
 */
export async function getChannelWeight(channelId: string): Promise<number> {
  const pool = getDbPool();
  
  const result = await pool.query(
    `SELECT weight FROM slack_channels WHERE channel_id = $1 AND is_active = TRUE`,
    [channelId]
  );
  
  if (result.rows.length === 0) {
    // Channel not in registry, return default weight
    return 1.0;
  }
  
  return result.rows[0].weight;
}

/**
 * Gets channel configuration by channel ID
 */
export async function getChannelConfig(channelId: string): Promise<ChannelConfig | null> {
  const pool = getDbPool();
  
  const result = await pool.query(
    `SELECT id, channel_id, channel_name, category, weight, is_active, workspace_id, description, metadata, created_at, updated_at
     FROM slack_channels
     WHERE channel_id = $1`,
    [channelId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return mapRowToChannelConfig(result.rows[0]);
}

/**
 * Updates channel configuration
 */
export async function updateChannelConfig(
  channelId: string, 
  updates: Partial<Pick<ChannelConfig, 'channelName' | 'category' | 'weight' | 'isActive' | 'description' | 'metadata'>>
): Promise<void> {
  const pool = getDbPool();
  
  const setClause: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;
  
  if (updates.channelName !== undefined) {
    setClause.push(`channel_name = $${paramIndex++}`);
    params.push(updates.channelName);
  }
  
  if (updates.category !== undefined) {
    setClause.push(`category = $${paramIndex++}`);
    params.push(updates.category);
  }
  
  if (updates.weight !== undefined) {
    setClause.push(`weight = $${paramIndex++}`);
    params.push(updates.weight);
  }
  
  if (updates.isActive !== undefined) {
    setClause.push(`is_active = $${paramIndex++}`);
    params.push(updates.isActive);
  }
  
  if (updates.description !== undefined) {
    setClause.push(`description = $${paramIndex++}`);
    params.push(updates.description);
  }
  
  if (updates.metadata !== undefined) {
    setClause.push(`metadata = $${paramIndex++}`);
    params.push(JSON.stringify(updates.metadata));
  }
  
  if (setClause.length === 0) {
    return; // Nothing to update
  }
  
  params.push(channelId);
  
  await pool.query(
    `UPDATE slack_channels SET ${setClause.join(', ')} WHERE channel_id = $${paramIndex}`,
    params
  );
  
  logger.info('Channel config updated', { channelId, updates: Object.keys(updates) });
}

/**
 * Deactivates a channel (soft delete)
 */
export async function deactivateChannel(channelId: string): Promise<void> {
  await updateChannelConfig(channelId, { isActive: false });
  logger.info('Channel deactivated', { channelId });
}

/**
 * Activates a channel
 */
export async function activateChannel(channelId: string): Promise<void> {
  await updateChannelConfig(channelId, { isActive: true });
  logger.info('Channel activated', { channelId });
}

/**
 * Gets channels by category
 */
export async function getChannelsByCategory(category: ChannelCategory): Promise<ChannelConfig[]> {
  const pool = getDbPool();
  
  const result = await pool.query(
    `SELECT id, channel_id, channel_name, category, weight, is_active, workspace_id, description, metadata, created_at, updated_at
     FROM slack_channels
     WHERE category = $1 AND is_active = TRUE
     ORDER BY weight DESC, channel_name`,
    [category]
  );
  
  return result.rows.map(mapRowToChannelConfig);
}

/**
 * Bulk registers multiple channels
 */
export async function registerChannelsBulk(
  configs: Array<Omit<ChannelConfig, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<string[]> {
  const ids: string[] = [];
  
  for (const config of configs) {
    const id = await registerChannel(config);
    ids.push(id);
  }
  
  logger.info('Bulk channel registration complete', { count: configs.length });
  return ids;
}

/**
 * Auto-registers a channel with category inference
 * Uses channel name patterns to infer category
 */
export async function autoRegisterChannel(
  channelId: string,
  channelName: string,
  workspaceId?: string
): Promise<string> {
  const category = inferChannelCategory(channelName);
  const weight = DEFAULT_CATEGORY_WEIGHTS[category];
  
  return registerChannel({
    channelId,
    channelName,
    category,
    weight,
    isActive: true,
    workspaceId
  });
}

/**
 * Infers channel category from name patterns
 */
function inferChannelCategory(channelName: string): ChannelCategory {
  const name = channelName.toLowerCase();
  
  // Customer engagement patterns
  if (name.includes('customer') || name.includes('client') || name.includes('engagement') || 
      name.includes('success') || name.includes('onboarding')) {
    return 'customer_engagement';
  }
  
  // Support patterns
  if (name.includes('support') || name.includes('help') || name.includes('ticket') ||
      name.includes('escalation') || name.includes('issue')) {
    return 'support';
  }
  
  // Sales patterns
  if (name.includes('sales') || name.includes('deal') || name.includes('opportunity') ||
      name.includes('prospect') || name.includes('pipeline')) {
    return 'sales';
  }
  
  // Engineering patterns
  if (name.includes('eng') || name.includes('dev') || name.includes('tech') ||
      name.includes('build') || name.includes('deploy') || name.includes('infra')) {
    return 'engineering';
  }
  
  return 'general';
}

/**
 * Maps database row to ChannelConfig interface
 */
function mapRowToChannelConfig(row: any): ChannelConfig {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    category: row.category as ChannelCategory,
    weight: row.weight,
    isActive: row.is_active,
    workspaceId: row.workspace_id,
    description: row.description,
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
    createdAt: row.created_at ? new Date(row.created_at) : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
  };
}
