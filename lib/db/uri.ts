/**
 * MongoDB connection-string resolution, shared by `connectDB()`
 * (models/index.ts) and `getMongoDBURI()` (lib/config.ts).
 *
 * Order: the `MONGODB_URI` environment variable, then `database.uri` in
 * `config.json` with `${VAR}` placeholders substituted from the environment.
 * There is deliberately no default: an unset or empty URI stops the process
 * with MissingMongoUriError instead of silently connecting to an
 * unauthenticated `localhost`, which is what hid the missing `.env` loading
 * of the CLI tools until MongoDB authentication was enabled in production.
 *
 * Error messages never contain the URI (it may hold credentials).
 */
import fs from 'fs';
import path from 'path';

export type MongoUriSource = 'environment' | 'config.json';

export class MongoUriConfigError extends Error {}

export class MissingMongoUriError extends MongoUriConfigError {
  constructor() {
    super(
      'MONGODB_URI is not set. Put it in .env (or .env.local) in the project root, or export it ' +
        'in the environment; the explorer never falls back to an unauthenticated default database.'
    );
    this.name = 'MissingMongoUriError';
  }
}

export class InvalidMongoUriError extends MongoUriConfigError {
  constructor(source: MongoUriSource) {
    super(
      `The MongoDB URI from the ${source} is not a mongodb:// or mongodb+srv:// connection string.`
    );
    this.name = 'InvalidMongoUriError';
  }
}

/** Plain variable map; `process.env` qualifies (NodeJS.ProcessEnv requires NODE_ENV here). */
export type EnvVars = Record<string, string | undefined>;

export interface ResolveMongoUriOptions {
  /** Environment to read from (default: `process.env`). */
  env?: EnvVars;
  /** Directory that holds `config.json` (default: `process.cwd()`). */
  cwd?: string;
  /** Explicit path of the config file (overrides `cwd`). */
  configPath?: string;
}

export interface ResolvedMongoUri {
  uri: string;
  source: MongoUriSource;
}

const MONGO_SCHEME = /^mongodb(\+srv)?:\/\//i;

/** Replace `${VAR}` with the variable's value; unset variables become ''. */
export function substituteEnvPlaceholders(value: string, env: EnvVars): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => env[name] ?? '');
}

function validated(uri: string, source: MongoUriSource): ResolvedMongoUri {
  if (!MONGO_SCHEME.test(uri)) throw new InvalidMongoUriError(source);
  return { uri, source };
}

function uriFromConfigFile(configPath: string, env: EnvVars): string | null {
  if (!fs.existsSync(configPath)) return null;
  let raw: unknown;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      database?: { uri?: unknown };
    };
    raw = parsed?.database?.uri;
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const resolved = substituteEnvPlaceholders(raw, env).trim();
  return resolved || null;
}

/**
 * The connection string to use, or a MongoUriConfigError when none is
 * configured. Never returns a default.
 */
export function resolveMongoUri(options: ResolveMongoUriOptions = {}): ResolvedMongoUri {
  const env: EnvVars = options.env ?? process.env;
  const fromEnv = (env.MONGODB_URI ?? '').trim();
  if (fromEnv) return validated(fromEnv, 'environment');

  const configPath = options.configPath ?? path.join(options.cwd ?? process.cwd(), 'config.json');
  const fromConfig = uriFromConfigFile(configPath, env);
  if (fromConfig) return validated(fromConfig, 'config.json');

  throw new MissingMongoUriError();
}
