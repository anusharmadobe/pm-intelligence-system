import winston from 'winston';
import path from 'path';

// Define custom log levels with trace added for ultra-detailed debugging
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    trace: 'gray'
  }
};

// Add colors to Winston
winston.addColors(customLevels.colors);

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

export const logger = winston.createLogger({
  levels: customLevels.levels,
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'pm-intelligence' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: consoleFormat
    }),
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Write all logs to combined.log
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

/**
 * Creates a module-specific logger that respects module-level log configuration.
 *
 * @param moduleName - Name of the module (e.g., 'opportunity', 'jira', 'export')
 * @param moduleEnvVar - Optional environment variable for module-specific log level (e.g., 'LOG_LEVEL_OPPORTUNITY')
 * @returns Logger instance with module metadata and module-specific level filtering
 *
 * @example
 * const opportunityLogger = createModuleLogger('opportunity', 'LOG_LEVEL_OPPORTUNITY');
 * opportunityLogger.debug('Clustering signals', { count: 10 });
 */
export function createModuleLogger(moduleName: string, moduleEnvVar?: string): winston.Logger {
  const effectiveLevel = moduleEnvVar && process.env[moduleEnvVar]
    ? process.env[moduleEnvVar]
    : process.env.LOG_LEVEL || 'info';

  // Map level names to numeric priorities
  const levelPriorities: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4
  };

  const moduleLoggerLevel = levelPriorities[effectiveLevel] || levelPriorities.info;

  // Create a child logger with filtering format
  const childLogger = logger.child({
    module: moduleName
  });

  // Create a wrapper that filters logs based on module-specific level
  const wrappedLogger = Object.create(childLogger);

  ['error', 'warn', 'info', 'debug', 'trace'].forEach((level) => {
    const originalMethod = childLogger[level as keyof winston.Logger] as Function;
    wrappedLogger[level] = function(message: string, meta?: any) {
      // Only log if the message level is enabled for this module
      const messagePriority = levelPriorities[level] || 0;
      if (messagePriority <= moduleLoggerLevel) {
        return originalMethod.call(childLogger, message, meta);
      }
      return childLogger; // Return logger for chaining
    };
  });

  return wrappedLogger as winston.Logger;
}

/**
 * Logs operation timing information at debug level.
 *
 * @param operation - Description of the operation
 * @param startTime - Start timestamp from Date.now()
 * @param metadata - Additional metadata to include in the log
 *
 * @example
 * const start = Date.now();
 * // ... operation ...
 * logTiming('Signal clustering', start, { signalCount: 50, clusterCount: 10 });
 */
export function logTiming(operation: string, startTime: number, metadata?: Record<string, any>): void {
  const durationMs = Date.now() - startTime;
  logger.debug(`${operation} completed`, {
    duration_ms: durationMs,
    ...metadata
  });
}

/**
 * TypeScript type extensions for Winston logger to support trace level
 */
declare module 'winston' {
  interface Logger {
    trace(message: string, meta?: any): Logger;
  }
}

// Create logs directory if it doesn't exist
import { mkdirSync } from 'fs';
try {
  mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
} catch (error) {
  // Directory might already exist
}
