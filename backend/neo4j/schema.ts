import { config } from '../config/env';
import { getNeo4jDriver } from './client';
import { logger } from '../utils/logger';

const constraintQueries = [
  'CREATE CONSTRAINT customer_id IF NOT EXISTS FOR (c:Customer) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT feature_id IF NOT EXISTS FOR (f:Feature) REQUIRE f.id IS UNIQUE',
  'CREATE CONSTRAINT issue_id IF NOT EXISTS FOR (i:Issue) REQUIRE i.id IS UNIQUE',
  'CREATE CONSTRAINT theme_id IF NOT EXISTS FOR (t:Theme) REQUIRE t.id IS UNIQUE',
  'CREATE CONSTRAINT signal_id IF NOT EXISTS FOR (s:Signal) REQUIRE s.id IS UNIQUE',
  'CREATE CONSTRAINT opportunity_id IF NOT EXISTS FOR (o:Opportunity) REQUIRE o.id IS UNIQUE',
  'CREATE CONSTRAINT stakeholder_id IF NOT EXISTS FOR (st:Stakeholder) REQUIRE st.id IS UNIQUE',
  'CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE',
  'CREATE CONSTRAINT artifact_id IF NOT EXISTS FOR (a:Artifact) REQUIRE a.id IS UNIQUE'
];

const indexQueries = [
  'CREATE INDEX signal_timestamp IF NOT EXISTS FOR (s:Signal) ON (s.timestamp)',
  'CREATE INDEX signal_source IF NOT EXISTS FOR (s:Signal) ON (s.source)',
  'CREATE INDEX issue_severity IF NOT EXISTS FOR (i:Issue) ON (i.severity)',
  'CREATE INDEX issue_status IF NOT EXISTS FOR (i:Issue) ON (i.status)',
  'CREATE INDEX feature_area IF NOT EXISTS FOR (f:Feature) ON (f.product_area)',
  'CREATE INDEX customer_segment IF NOT EXISTS FOR (c:Customer) ON (c.segment)',
  'CREATE INDEX theme_level IF NOT EXISTS FOR (t:Theme) ON (t.level)'
];

export async function initializeNeo4jSchema(): Promise<void> {
  const driver = getNeo4jDriver();
  const session = driver.session({ database: config.neo4j.database });

  try {
    for (const query of constraintQueries) {
      await session.run(query);
    }
    for (const query of indexQueries) {
      await session.run(query);
    }
    logger.info('Neo4j schema initialized', { database: config.neo4j.database });
  } catch (error) {
    logger.error('Neo4j schema initialization failed', { error });
    throw error;
  } finally {
    await session.close();
  }
}
