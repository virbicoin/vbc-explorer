/**
 * Environment file loading for processes that run outside Next.js: the CLI
 * tools in tools/, one-off scripts and tests.
 *
 * Next.js reads `.env` / `.env.local` itself; the tools never did. When
 * MongoDB authentication was enabled in production, every tool fell back to
 * a credential-less default URI and died with "requires authentication".
 * A tool now makes `import '../lib/env';` its very first import, which loads
 * the files from the current working directory with `process.loadEnvFile()`
 * before any other module looks at `process.env`:
 *
 *   environment  >  .env.local  >  .env
 *
 * `loadEnvFile()` never overrides a variable that is already set, so the
 * files are read in reverse precedence order (`.env.local` first). Missing
 * files are skipped. Only the file names and the MongoDB host / database are
 * logged; user names and passwords never are. No dotenv dependency.
 */
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

/** Files read from the working directory, highest precedence first. */
export const ENV_FILES: readonly string[] = ['.env.local', '.env'];

export interface LoadEnvOptions {
  /** Directory that holds the files (default: `process.cwd()`). */
  cwd?: string;
  /** File names, highest precedence first (default: ENV_FILES). */
  files?: readonly string[];
  /** Log the loaded files and the MongoDB target (default: true). */
  log?: boolean;
}

export interface LoadEnvResult {
  /** Files that existed and were loaded, in load order. */
  loaded: string[];
  /** Files that did not exist. */
  missing: string[];
}

export interface MongoUriSummary {
  /** `host:port` (or the comma-separated host list); never the credentials. */
  host: string;
  database: string | null;
  /** True when the URI carries `user:password@`. */
  authenticated: boolean;
}

/**
 * Host, database and whether credentials are present, for logging. The user
 * name and password are never part of the result.
 */
export function describeMongoUri(uri: string | null | undefined): MongoUriSummary | null {
  if (typeof uri !== 'string' || !uri.trim()) return null;
  const match = /^mongodb(?:\+srv)?:\/\/(?:([^/?]*)@)?([^/?]*)(?:\/([^?#]*))?/i.exec(uri.trim());
  if (!match) return null;
  const [, credentials, host, database] = match;
  return {
    host: host ?? '',
    database: database ? database : null,
    authenticated: typeof credentials === 'string' && credentials.length > 0,
  };
}

/**
 * Load the environment files from `cwd`. Variables already present in the
 * environment keep their value; a file that does not exist is skipped.
 */
export function loadEnvFiles(options: LoadEnvOptions = {}): LoadEnvResult {
  const cwd = options.cwd ?? process.cwd();
  const files = options.files ?? ENV_FILES;
  const result: LoadEnvResult = { loaded: [], missing: [] };

  for (const name of files) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) {
      result.missing.push(name);
      continue;
    }
    try {
      // Node 20.12+ / 24: parses the file and sets only the keys that are not
      // already defined in process.env.
      process.loadEnvFile(file);
      result.loaded.push(name);
    } catch (error) {
      logger.warn('Environment file could not be read', {
        file: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (options.log !== false && result.loaded.length > 0) {
    const mongodb = describeMongoUri(process.env.MONGODB_URI);
    logger.info('Environment files loaded', {
      files: result.loaded,
      ...(mongodb
        ? { mongodb: { host: mongodb.host, database: mongodb.database } }
        : { mongodb: 'MONGODB_URI not set' }),
    });
  }
  return result;
}

// Side effect on import: the CLI tools rely on this running before any other
// module reads process.env (ES module imports are evaluated in order).
loadEnvFiles();
