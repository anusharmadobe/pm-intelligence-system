import { logger } from '../utils/logger';
import { getNeo4jDriver } from '../neo4j/client';
import { config } from '../config/env';

// Timeout for Neo4j operations (15 seconds for graph queries)
const NEO4J_TIMEOUT_MS = 15000;

export class KnowledgeGraphService {
  /**
   * Executes a Neo4j query with timeout protection
   */
  private async runWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number = NEO4J_TIMEOUT_MS
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Neo4j operation timeout')), timeoutMs)
      )
    ]);
  }


  private mapEntityLabel(entityType: string): string {
    switch (entityType) {
      case 'customer':
        return 'Customer';
      case 'feature':
        return 'Feature';
      case 'issue':
        return 'Issue';
      case 'theme':
        return 'Theme';
      case 'stakeholder':
        return 'Stakeholder';
      default:
        return 'Entity';
    }
  }

  async findRelatedEntities(params: {
    entity_name: string;
    entity_type: string;
    max_hops?: number;
    limit?: number;
  }) {
    const startTime = Date.now();
    const session = getNeo4jDriver().session({ database: config.neo4j.database });
    const label = this.mapEntityLabel(params.entity_type);
    // Validate maxHops to prevent DoS attacks via expensive graph traversals
    const maxHops = Math.min(Math.max(1, params.max_hops || 2), 5);
    const limit = Math.min(params.limit || 50, 1000);

    logger.debug('Finding related entities in Neo4j', {
      stage: 'knowledge_graph',
      operation: 'findRelatedEntities',
      entity_name: params.entity_name,
      entity_type: params.entity_type,
      label,
      max_hops: maxHops,
      limit
    });

    try {
      const result = await this.runWithTimeout(() =>
        session.run(
          `MATCH (root:${label} {canonical_name: $name})
           MATCH path = (root)-[*1..${maxHops}]-(related)
           RETURN DISTINCT related, labels(related) AS labels
           LIMIT $limit`,
          { name: params.entity_name, limit }
        )
      );

      const entities = result.records.map((record) => {
        const node = record.get('related');
        return {
          id: node.properties.id,
          canonical_name: node.properties.canonical_name,
          labels: record.get('labels')
        };
      });

      logger.info('Related entities found', {
        stage: 'knowledge_graph',
        operation: 'findRelatedEntities',
        entity_name: params.entity_name,
        related_count: entities.length,
        duration_ms: Date.now() - startTime
      });

      return entities;
    } catch (error: any) {
      logger.error('Neo4j query failed: findRelatedEntities', {
        stage: 'knowledge_graph',
        operation: 'findRelatedEntities',
        entity_name: params.entity_name,
        entity_type: params.entity_type,
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw error;
    } finally {
      await session.close();
    }
  }

  async browseGraph(params: {
    root_entity_type: string;
    root_entity_name: string;
    max_hops?: number;
    limit?: number;
  }) {
    const startTime = Date.now();
    const session = getNeo4jDriver().session({ database: config.neo4j.database });
    const label = this.mapEntityLabel(params.root_entity_type);
    // Validate maxHops to prevent DoS attacks via expensive graph traversals
    const maxHops = Math.min(Math.max(0, params.max_hops || 2), 5);
    const limit = Math.min(params.limit || 100, 1000);

    logger.debug('Browsing knowledge graph from root entity', {
      stage: 'knowledge_graph',
      operation: 'browseGraph',
      root_entity_name: params.root_entity_name,
      root_entity_type: params.root_entity_type,
      label,
      max_hops: maxHops,
      limit
    });

    try {
      const result = await this.runWithTimeout(() =>
        session.run(
          `MATCH (root:${label} {canonical_name: $name})
           MATCH path = (root)-[*0..${maxHops}]-(node)
           RETURN DISTINCT node, labels(node) AS labels
           LIMIT $limit`,
          { name: params.root_entity_name, limit }
        )
      );

      const nodes = result.records.map((record) => {
        const node = record.get('node');
        return {
          id: node.properties.id,
          canonical_name: node.properties.canonical_name,
          labels: record.get('labels')
        };
      });

      logger.info('Graph browsing complete', {
        stage: 'knowledge_graph',
        operation: 'browseGraph',
        root_entity_name: params.root_entity_name,
        node_count: nodes.length,
        duration_ms: Date.now() - startTime
      });

      return nodes;
    } catch (error: any) {
      logger.error('Neo4j query failed: browseGraph', {
        stage: 'knowledge_graph',
        operation: 'browseGraph',
        root_entity_name: params.root_entity_name,
        root_entity_type: params.root_entity_type,
        error: error.message,
        stack: error.stack,
        duration_ms: Date.now() - startTime
      });
      throw error;
    } finally {
      await session.close();
    }
  }
}
