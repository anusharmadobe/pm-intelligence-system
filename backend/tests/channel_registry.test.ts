import { 
  registerChannel, 
  getActiveChannels, 
  getChannelWeight,
  getChannelConfig,
  updateChannelConfig,
  deactivateChannel,
  activateChannel,
  getChannelsByCategory,
  autoRegisterChannel,
  ChannelConfig
} from '../services/channel_registry_service';
import { runMigrations, resetDatabase, shutdownDatabase } from './test_db';

describe('Channel Registry Service', () => {
  beforeAll(() => {
    runMigrations();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await shutdownDatabase();
  });

  describe('registerChannel', () => {
    it('should register a new channel with default weight', async () => {
      const channelId = await registerChannel({
        channelId: 'C04D195JVGS',
        channelName: 'customer-engagement',
        category: 'customer_engagement',
        weight: 1.5,
        isActive: true
      });

      expect(channelId).toBeDefined();
      expect(typeof channelId).toBe('string');
    });

    it('should register a channel with custom weight', async () => {
      await registerChannel({
        channelId: 'C123456789',
        channelName: 'vip-customers',
        category: 'customer_engagement',
        weight: 3.5,
        isActive: true
      });

      const weight = await getChannelWeight('C123456789');
      expect(weight).toBe(3.5);
    });

    it('should register channels with different categories', async () => {
      await registerChannel({
        channelId: 'C-SUPPORT',
        channelName: 'support-tickets',
        category: 'support',
        weight: 1.3,
        isActive: true
      });

      await registerChannel({
        channelId: 'C-SALES',
        channelName: 'sales-discussions',
        category: 'sales',
        weight: 1.2,
        isActive: true
      });

      const supportChannels = await getChannelsByCategory('support');
      const salesChannels = await getChannelsByCategory('sales');

      expect(supportChannels.length).toBe(1);
      expect(supportChannels[0].channelName).toBe('support-tickets');
      expect(salesChannels.length).toBe(1);
      expect(salesChannels[0].channelName).toBe('sales-discussions');
    });
  });

  describe('getChannelWeight', () => {
    it('should return default weight for unknown channel', async () => {
      const weight = await getChannelWeight('UNKNOWN_CHANNEL');
      expect(weight).toBe(1.0);
    });

    it('should return configured weight for registered channel', async () => {
      await registerChannel({
        channelId: 'C-WEIGHTED',
        channelName: 'weighted-channel',
        category: 'customer_engagement',
        weight: 2.5,
        isActive: true
      });

      const weight = await getChannelWeight('C-WEIGHTED');
      expect(weight).toBe(2.5);
    });
  });

  describe('getActiveChannels', () => {
    it('should return only active channels', async () => {
      await registerChannel({
        channelId: 'C-ACTIVE',
        channelName: 'active-channel',
        category: 'general',
        weight: 0.8,
        isActive: true
      });

      await registerChannel({
        channelId: 'C-INACTIVE',
        channelName: 'inactive-channel',
        category: 'general',
        weight: 0.8,
        isActive: false
      });

      const activeChannels = await getActiveChannels();
      const channelIds = activeChannels.map(c => c.channelId);

      expect(channelIds).toContain('C-ACTIVE');
      expect(channelIds).not.toContain('C-INACTIVE');
    });
  });

  describe('updateChannelConfig', () => {
    it('should update channel weight', async () => {
      await registerChannel({
        channelId: 'C-UPDATE',
        channelName: 'update-channel',
        category: 'general',
        weight: 1.0,
        isActive: true
      });

      await updateChannelConfig('C-UPDATE', { weight: 4.0 });

      const weight = await getChannelWeight('C-UPDATE');
      expect(weight).toBe(4.0);
    });

    it('should update channel category', async () => {
      await registerChannel({
        channelId: 'C-CATEGORY',
        channelName: 'category-channel',
        category: 'general',
        weight: 0.8,
        isActive: true
      });

      await updateChannelConfig('C-CATEGORY', { category: 'support' });

      const config = await getChannelConfig('C-CATEGORY');
      expect(config?.category).toBe('support');
    });
  });

  describe('deactivateChannel and activateChannel', () => {
    it('should deactivate and reactivate a channel', async () => {
      await registerChannel({
        channelId: 'C-TOGGLE',
        channelName: 'toggle-channel',
        category: 'general',
        weight: 0.8,
        isActive: true
      });

      // Deactivate
      await deactivateChannel('C-TOGGLE');
      let config = await getChannelConfig('C-TOGGLE');
      expect(config?.isActive).toBe(false);

      // Reactivate
      await activateChannel('C-TOGGLE');
      config = await getChannelConfig('C-TOGGLE');
      expect(config?.isActive).toBe(true);
    });
  });

  describe('autoRegisterChannel', () => {
    it('should infer category from channel name', async () => {
      await autoRegisterChannel('C-SUPPORT-AUTO', 'support-help');
      const config = await getChannelConfig('C-SUPPORT-AUTO');
      expect(config?.category).toBe('support');

      await autoRegisterChannel('C-SALES-AUTO', 'sales-pipeline');
      const salesConfig = await getChannelConfig('C-SALES-AUTO');
      expect(salesConfig?.category).toBe('sales');
    });

    it('should apply category-based default weights', async () => {
      await autoRegisterChannel('C-ENG', 'customer-success');
      const engagementConfig = await getChannelConfig('C-ENG');
      expect(engagementConfig?.weight).toBeGreaterThan(1.0);
    });
  });
});
