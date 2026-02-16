/**
 * Environment configuration management
 */

export interface Config {
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    url: string;
  };
  api: {
    port: number;
    host: string;
  };
  neo4j: {
    uri: string;
    user: string;
    password: string;
    database: string;
  };
  redis: {
    url: string;
    password: string;
  };
  mcp: {
    port: number;
    name: string;
  };
  ingestion: {
    uploadDir: string;
    maxFileSizeMb: number;
    maxBatchFiles: number;
    concurrency: number;
    supportedFormats: string[];
  };
  slack: {
    channelIds: string[];
    batchSize: number;
    maxMessagesPerChannel: number;
    includeThreads: boolean;
    botToken: string;
  };
  entityResolution: {
    autoMergeThreshold: number;
    humanReviewThreshold: number;
    rejectThreshold: number;
  };
  llm: {
    fastDeployment: string;
    fastTemperature: number;
    fastMaxTokens: number;
  };
  agent: {
    rateLimitRpm: number;
    maxMonthlyCostUsd: number;
  };
  featureFlags: {
    neo4jSync: boolean;
    twoPassLlm: boolean;
    hallucinationGuard: boolean;
    graphragIndexer: boolean;
    a2aServer: boolean;
    agentGateway: boolean;
    eventBus: boolean;
    stakeholderAccess: boolean;
    erLlmConfirmation: boolean;
  };
  security: {
    enableRBAC: boolean;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  // DB_PASSWORD can be empty (no password)
  if (!value && defaultValue === undefined && key !== 'DB_PASSWORD') {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value || defaultValue || '';
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function getEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseFloat(value) : defaultValue;
}

export function loadConfig(): Config {
  const host = getEnvVar('DB_HOST', 'localhost');
  const port = getEnvNumber('DB_PORT', 5432);
  const database = getEnvVar('DB_NAME', 'pm_intelligence');
  const user = getEnvVar('DB_USER', 'postgres');
  const password = getEnvVar('DB_PASSWORD', '');
  const databaseUrl = process.env.DATABASE_URL
    ? process.env.DATABASE_URL
    : `postgresql://${user}${password ? `:${encodeURIComponent(password)}` : ''}@${host}:${port}/${database}`;

  return {
    db: {
      host,
      port,
      database,
      user,
      password,
      url: databaseUrl
    },
    api: {
      port: getEnvNumber('PORT', 3000),
      host: getEnvVar('API_HOST', '0.0.0.0')
    },
    neo4j: {
      uri: getEnvVar('NEO4J_URI', 'bolt://localhost:7687'),
      user: getEnvVar('NEO4J_USER', 'neo4j'),
      password: getEnvVar('NEO4J_PASSWORD', 'neo4jpassword'),
      database: getEnvVar('NEO4J_DATABASE', 'neo4j')
    },
    redis: {
      url: getEnvVar('REDIS_URL', 'redis://localhost:6379'),
      password: getEnvVar('REDIS_PASSWORD', '')
    },
    mcp: {
      port: getEnvNumber('MCP_SERVER_PORT', 3001),
      name: getEnvVar('MCP_SERVER_NAME', 'pm-intelligence')
    },
    ingestion: {
      uploadDir: getEnvVar('UPLOAD_DIR', './data/uploads'),
      maxFileSizeMb: getEnvNumber('MAX_FILE_SIZE_MB', 50),
      maxBatchFiles: getEnvNumber('MAX_BATCH_FILES', 20),
      concurrency: getEnvNumber('INGESTION_CONCURRENCY', 5),
      supportedFormats: getEnvVar('SUPPORTED_FORMATS', 'pdf,docx,pptx,xlsx,csv,txt,vtt,srt')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    },
    slack: {
      channelIds: getEnvVar('SLACK_CHANNEL_IDS', '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      batchSize: getEnvNumber('SLACK_BATCH_SIZE', 200),
      maxMessagesPerChannel: getEnvNumber('SLACK_MAX_MESSAGES_PER_CHANNEL', 10000),
      includeThreads: getEnvBoolean('SLACK_INCLUDE_THREADS', true),
      botToken: getEnvVar('SLACK_BOT_TOKEN', '')
    },
    entityResolution: {
      autoMergeThreshold: getEnvFloat('ER_AUTO_MERGE_THRESHOLD', 0.9),
      humanReviewThreshold: getEnvFloat('ER_HUMAN_REVIEW_THRESHOLD', 0.6),
      rejectThreshold: getEnvFloat('ER_REJECT_THRESHOLD', 0.3)
    },
    llm: {
      fastDeployment: getEnvVar('AZURE_OPENAI_FAST_DEPLOYMENT', 'gpt-4o-mini'),
      fastTemperature: getEnvFloat('LLM_FAST_TEMPERATURE', 0.3),
      fastMaxTokens: getEnvNumber('LLM_FAST_MAX_TOKENS', 2048)
    },
    agent: {
      rateLimitRpm: getEnvNumber('AGENT_RATE_LIMIT_RPM', 60),
      maxMonthlyCostUsd: getEnvFloat('AGENT_MAX_MONTHLY_COST_USD', 50)
    },
    featureFlags: {
      neo4jSync: getEnvBoolean('FF_NEO4J_SYNC', true),
      twoPassLlm: getEnvBoolean('FF_TWO_PASS_LLM', true),
      hallucinationGuard: getEnvBoolean('FF_HALLUCINATION_GUARD', true),
      graphragIndexer: getEnvBoolean('FF_GRAPHRAG_INDEXER', false),
      a2aServer: getEnvBoolean('FF_A2A_SERVER', false),
      agentGateway: getEnvBoolean('FF_AGENT_GATEWAY', false),
      eventBus: getEnvBoolean('FF_EVENT_BUS', false),
      stakeholderAccess: getEnvBoolean('FF_STAKEHOLDER_ACCESS', false),
      erLlmConfirmation: getEnvBoolean('FF_ER_LLM_CONFIRMATION', false)
    },
    security: {
      enableRBAC: getEnvBoolean('ENABLE_RBAC', false)
    }
  };
}

export const config = loadConfig();
