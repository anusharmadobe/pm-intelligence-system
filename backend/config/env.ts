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
  };
  api: {
    port: number;
    host: string;
  };
  security: {
    enableRBAC: boolean;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  // DB_PASSWORD can be empty (no password)
  if (!value && !defaultValue && key !== 'DB_PASSWORD') {
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

export function loadConfig(): Config {
  return {
    db: {
      host: getEnvVar('DB_HOST', 'localhost'),
      port: getEnvNumber('DB_PORT', 5432),
      database: getEnvVar('DB_NAME', 'pm_intelligence'),
      user: getEnvVar('DB_USER', 'postgres'),
      password: getEnvVar('DB_PASSWORD', '')
    },
    api: {
      port: getEnvNumber('PORT', 3000),
      host: getEnvVar('API_HOST', '0.0.0.0')
    },
    security: {
      enableRBAC: getEnvBoolean('ENABLE_RBAC', false)
    }
  };
}

export const config = loadConfig();
