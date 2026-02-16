import { getNeo4jDriver } from '../neo4j/client';
import { config } from '../config/env';

export class KnowledgeGraphService {
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
    const session = getNeo4jDriver().session({ database: config.neo4j.database });
    const label = this.mapEntityLabel(params.entity_type);
    const maxHops = params.max_hops || 2;
    const limit = params.limit || 50;
    try {
      const result = await session.run(
        `MATCH (root:${label} {canonical_name: $name})
         MATCH path = (root)-[*1..${maxHops}]-(related)
         RETURN DISTINCT related, labels(related) AS labels
         LIMIT $limit`,
        { name: params.entity_name, limit }
      );
      return result.records.map((record) => {
        const node = record.get('related');
        return {
          id: node.properties.id,
          canonical_name: node.properties.canonical_name,
          labels: record.get('labels')
        };
      });
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
    const session = getNeo4jDriver().session({ database: config.neo4j.database });
    const label = this.mapEntityLabel(params.root_entity_type);
    const maxHops = params.max_hops || 2;
    const limit = params.limit || 100;
    try {
      const result = await session.run(
        `MATCH (root:${label} {canonical_name: $name})
         MATCH path = (root)-[*0..${maxHops}]-(node)
         RETURN DISTINCT node, labels(node) AS labels
         LIMIT $limit`,
        { name: params.root_entity_name, limit }
      );
      return result.records.map((record) => {
        const node = record.get('node');
        return {
          id: node.properties.id,
          canonical_name: node.properties.canonical_name,
          labels: record.get('labels')
        };
      });
    } finally {
      await session.close();
    }
  }
}
