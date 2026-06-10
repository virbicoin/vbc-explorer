/**
 * Lightweight structured logger
 *
 * Zero-dependency, level-aware logger for server-side code (API routes, sync
 * tools, DB layer). It replaces scattered `console.*` calls with a single,
 * controllable entry point.
 *
 * Behavior:
 * - Log level is read from the `LOG_LEVEL` env var (default: `info`).
 * - During tests (`NODE_ENV=test` or `VITEST`), only `error` is emitted so the
 *   test output stays clean.
 * - Each call accepts an optional structured context object.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('MongoDB connected', { uri: 'mongodb://…' });
 *   logger.error('Sync failed', { error });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/**
 * Resolve the effective minimum log level from the environment.
 * Exported for testing.
 */
export function resolveLevel(env: Record<string, string | undefined> = process.env): LogLevel {
  const isTest = env.NODE_ENV === 'test' || env.VITEST === 'true';
  if (isTest) return 'error';

  const raw = (env.LOG_LEVEL || '').toLowerCase();
  if (raw in LEVEL_WEIGHT) return raw as LogLevel;
  return 'info';
}

/**
 * Pure predicate deciding whether a message at `level` should be emitted given
 * the configured minimum level. Exported for testing.
 */
export function shouldLog(level: Exclude<LogLevel, 'silent'>, configured: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configured];
}

type Meta = Record<string, unknown>;

function emit(level: Exclude<LogLevel, 'silent'>, message: string, meta?: Meta): void {
  if (!shouldLog(level, resolveLevel())) return;

  const prefix = `[${level.toUpperCase()}]`;
  // Route to the matching console method; fall back to console.log.
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (meta && Object.keys(meta).length > 0) {
    sink(prefix, message, meta);
  } else {
    sink(prefix, message);
  }
}

export const logger = {
  debug: (message: string, meta?: Meta) => emit('debug', message, meta),
  info: (message: string, meta?: Meta) => emit('info', message, meta),
  warn: (message: string, meta?: Meta) => emit('warn', message, meta),
  error: (message: string, meta?: Meta) => emit('error', message, meta),
};

export default logger;
