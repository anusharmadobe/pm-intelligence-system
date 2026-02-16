import { getSystemHealth } from '../services/health_service';
import { getDbPool } from '../db/connection';
import { getNeo4jDriver } from '../neo4j/client';
import { getSharedRedis } from '../config/redis';

jest.mock('../db/connection');
jest.mock('../neo4j/client');
jest.mock('../config/redis');
jest.mock('bullmq');

describe('HealthService', () => {
  let mockPool: any;
  let mockNeo4jDriver: any;
  let mockRedis: any;

  beforeEach(() => {
    // Mock PostgreSQL
    mockPool = {
      query: jest.fn()
    };
    (getDbPool as jest.Mock).mockReturnValue(mockPool);

    // Mock Neo4j
    mockNeo4jDriver = {
      session: jest.fn(() => ({
        run: jest.fn().mockResolvedValue({}),
        close: jest.fn().mockResolvedValue(undefined)
      }))
    };
    (getNeo4jDriver as jest.Mock).mockReturnValue(mockNeo4jDriver);

    // Mock Redis
    mockRedis = {
      ping: jest.fn().mockResolvedValue('PONG')
    };
    (getSharedRedis as jest.Mock).mockReturnValue(mockRedis);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSystemHealth', () => {
    it('should return healthy status when all services are up', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // SELECT 1
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // backlog count
        .mockResolvedValueOnce({ rows: [{ last_run: '2024-01-15T10:00:00Z' }] }); // last pipeline run

      const health = await getSystemHealth();

      expect(health.postgresql).toBe('healthy');
      expect(health.redis).toBe('healthy');
      expect(health.neo4j).toBe('healthy');
      expect(health.neo4j_backlog_pending).toBe(0);
      expect(health.last_pipeline_run).toBe('2024-01-15T10:00:00Z');
    });

    it('should detect PostgreSQL failure', async () => {
      mockPool.query.mockRejectedValue(new Error('Connection refused'));

      const health = await getSystemHealth();

      expect(health.postgresql).toBe('unhealthy');
    });

    it('should detect Neo4j failure', async () => {
      mockNeo4jDriver.session.mockReturnValue({
        run: jest.fn().mockRejectedValue(new Error('Neo4j unavailable')),
        close: jest.fn()
      });

      const health = await getSystemHealth();

      expect(health.neo4j).toBe('unhealthy');
    });

    it('should detect Redis failure', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Redis connection timeout'));

      const health = await getSystemHealth();

      expect(health.redis).toBe('unhealthy');
    });

    it('should handle partial failures gracefully', async () => {
      // PostgreSQL healthy
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [{ last_run: null }] });

      // Neo4j unhealthy
      mockNeo4jDriver.session.mockReturnValue({
        run: jest.fn().mockRejectedValue(new Error('Neo4j down')),
        close: jest.fn()
      });

      // Redis healthy
      mockRedis.ping.mockResolvedValue('PONG');

      const health = await getSystemHealth();

      expect(health.postgresql).toBe('healthy');
      expect(health.neo4j).toBe('unhealthy');
      expect(health.redis).toBe('healthy');
      expect(health.neo4j_backlog_pending).toBe(5);
    });

    it('should report ingestion queue stats', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 10 }] })
        .mockResolvedValueOnce({ rows: [{ last_run: '2024-01-15T10:00:00Z' }] });

      // Mock Queue for BullMQ
      const mockQueue = {
        getWaitingCount: jest.fn().mockResolvedValue(25),
        getFailedCount: jest.fn().mockResolvedValue(3)
      };

      const { Queue } = require('bullmq');
      Queue.mockImplementation(() => mockQueue);

      const health = await getSystemHealth();

      expect(health.ingestion_queue).toEqual({
        waiting: 25,
        failed: 3
      });
    });

    it('should handle missing backlog table', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // SELECT 1
        .mockRejectedValueOnce(new Error('relation "neo4j_sync_backlog" does not exist'))
        .mockResolvedValueOnce({ rows: [{ last_run: null }] });

      const health = await getSystemHealth();

      expect(health.postgresql).toBe('healthy');
      expect(health.neo4j_backlog_pending).toBe(0);
    });

    it('should handle null last_pipeline_run', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_run: null }] });

      const health = await getSystemHealth();

      expect(health.last_pipeline_run).toBeNull();
    });

    it('should return entity_resolution_queue as 0', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_run: null }] });

      const health = await getSystemHealth();

      expect(health.entity_resolution_queue).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should not throw errors if health checks fail', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'));
      mockNeo4jDriver.session.mockImplementation(() => {
        throw new Error('Neo4j error');
      });
      mockRedis.ping.mockRejectedValue(new Error('Redis error'));

      await expect(getSystemHealth()).resolves.toBeDefined();
    });

    it('should log warnings for aggregation query failures', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // SELECT 1 succeeds
        .mockRejectedValueOnce(new Error('Aggregation query failed')); // Backlog query fails

      const health = await getSystemHealth();

      expect(health.postgresql).toBe('healthy');
      expect(health.neo4j_backlog_pending).toBe(0);
    });
  });

  describe('Response Format', () => {
    it('should return all required health check fields', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_run: null }] });

      const health = await getSystemHealth();

      expect(health).toHaveProperty('postgresql');
      expect(health).toHaveProperty('redis');
      expect(health).toHaveProperty('neo4j');
      expect(health).toHaveProperty('ingestion_queue');
      expect(health).toHaveProperty('entity_resolution_queue');
      expect(health).toHaveProperty('neo4j_backlog_pending');
      expect(health).toHaveProperty('last_pipeline_run');
    });

    it('should not include Python service health checks', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ last_run: null }] });

      const health = await getSystemHealth();

      expect(health).not.toHaveProperty('python_doc_parser');
      expect(health).not.toHaveProperty('python_graphrag_indexer');
    });
  });
});
