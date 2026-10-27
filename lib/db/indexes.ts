/**
 * Index management helpers
 *
 * The Mongoose schemas in `models/index.ts` are the single source of truth for
 * every index. These helpers create whatever a schema declares and never delete
 * anything: `Model.syncIndexes()` drops indexes that are not in the schema, so
 * it is deliberately not used. `autoIndex` stays disabled and the Next.js app
 * never touches indexes; the data-writing CLI tools call `ensureIndexes()`
 * (models/index.ts) right after connecting, and `tools/optimize-indexes.ts`
 * wraps the same function for manual runs.
 *
 * Behavior:
 * - Unique indexes are only created after a duplicate-key check; when
 *   duplicates exist, that single index is skipped and reported.
 * - E11000 (duplicate key) and index option/key conflicts (codes 85/86) are
 *   logged as warnings; any other error is logged as an error. Both are
 *   returned in `failed` and never thrown, so callers keep running.
 * - `background: true` is never passed (ignored since MongoDB 4.2).
 */

import type { IndexDefinition, IndexOptions, Model, mongo } from 'mongoose';
import { logger } from '../logger';

/** Any registered Mongoose model; only schema/collection metadata is used. */
export type AnyModel = Model<any>;

export interface IndexSpec {
  /** Mongoose model name (e.g. `Block`). */
  model: string;
  /** Real collection name (`Model.collection.name`, e.g. `Block`, `tokentransfers`). */
  collection: string;
  /** Index name as MongoDB derives it (`number_1`, `miner_1_number_-1`, ...). */
  name: string;
  keys: IndexDefinition;
  options: IndexOptions;
  unique: boolean;
}

export interface DuplicateKeyCount {
  /** Number of distinct key values that occur more than once. */
  keys: number;
  /** Number of documents that would have to be removed to make the key unique. */
  extraDocuments: number;
}

export interface SkippedIndex {
  model: string;
  collection: string;
  index: string;
  reason: string;
}

export interface FailedIndex {
  model: string;
  collection: string;
  index: string;
  error: string;
}

export interface EnsureIndexesResult {
  /** Indexes created by this run, as `<collection>.<index name>`. */
  created: string[];
  /** Indexes that already existed before this run. */
  existing: string[];
  /** Indexes that would be created (dry-run only). */
  planned: string[];
  /** Unique indexes skipped because the collection holds duplicate keys. */
  skipped: SkippedIndex[];
  /** Indexes whose creation (or duplicate check) failed. */
  failed: FailedIndex[];
}

export interface EnsureIndexesOptions {
  /** Report what would be created without creating anything. */
  dryRun?: boolean;
  /** `maxTimeMS` for the duplicate-key aggregation (default: 60s). */
  duplicateCheckMaxTimeMS?: number;
}

const NAMESPACE_NOT_FOUND = 26;
const INDEX_OPTIONS_CONFLICT = 85;
const INDEX_KEY_SPECS_CONFLICT = 86;
const DUPLICATE_KEY = 11000;
const DEFAULT_DUPLICATE_CHECK_MAX_TIME_MS = 60_000;

/** Empty result, also used when index sync is skipped. */
export function emptyEnsureIndexesResult(): EnsureIndexesResult {
  return { created: [], existing: [], planned: [], skipped: [], failed: [] };
}

/**
 * Index name as MongoDB derives it from the key pattern (`field_1_other_-1`),
 * unless the schema set an explicit `name`.
 */
export function indexNameFor(keys: IndexDefinition, options?: IndexOptions): string {
  if (options?.name) return options.name;
  return Object.entries(keys)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}

/** Every index a model's schema declares (path-level `index`/`unique` and `schema.index()`). */
export function schemaIndexSpecs(model: AnyModel): IndexSpec[] {
  return model.schema.indexes().map(([keys, rawOptions]) => {
    const options: IndexOptions & { background?: boolean } = { ...(rawOptions ?? {}) };
    // Ignored by MongoDB 4.2+ and rejected by some drivers; never forward it.
    delete options.background;
    return {
      model: model.modelName,
      collection: model.collection.name,
      name: indexNameFor(keys, options),
      keys,
      options,
      unique: options.unique === true,
    };
  });
}

function errorCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isNamespaceNotFound(err: unknown): boolean {
  return errorCode(err) === NAMESPACE_NOT_FOUND || /ns does not exist/i.test(errorMessage(err));
}

/** Names of the indexes currently on the model's collection (empty when it does not exist yet). */
export async function listIndexNames(model: AnyModel): Promise<string[]> {
  try {
    const indexes = await model.collection.indexes();
    return indexes.map((index) => String(index.name));
  } catch (err) {
    if (isNamespaceNotFound(err)) return [];
    throw err;
  }
}

/**
 * Count duplicate values for a (compound) key with a single `$group` pass.
 * Runs with `allowDiskUse` and a `maxTimeMS` guard so it is safe on large
 * collections, but it is still a full scan: call it only when about to create
 * a unique index.
 */
export async function countDuplicateKeys(
  model: AnyModel,
  keys: IndexDefinition,
  options: { sparse?: boolean; maxTimeMS?: number } = {}
): Promise<DuplicateKeyCount> {
  const fields = Object.keys(keys);
  const groupId = Object.fromEntries(fields.map((field) => [field, `$${field}`]));
  const pipeline: Record<string, unknown>[] = [];
  if (options.sparse) {
    // A sparse index only contains documents that have at least one key field.
    pipeline.push({ $match: { $or: fields.map((field) => ({ [field]: { $exists: true } })) } });
  }
  pipeline.push(
    { $group: { _id: groupId, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    {
      $group: {
        _id: null,
        keys: { $sum: 1 },
        extraDocuments: { $sum: { $subtract: ['$n', 1] } },
      },
    }
  );

  const rows = await model.collection
    .aggregate(pipeline, {
      allowDiskUse: true,
      maxTimeMS: options.maxTimeMS ?? DEFAULT_DUPLICATE_CHECK_MAX_TIME_MS,
    })
    .toArray();
  const row = rows[0] as { keys?: number; extraDocuments?: number } | undefined;
  return { keys: row?.keys ?? 0, extraDocuments: row?.extraDocuments ?? 0 };
}

/** Schema indexes that are not present on their collections (read-only check). */
export async function findMissingIndexes(models: AnyModel[]): Promise<IndexSpec[]> {
  const missing: IndexSpec[] = [];
  for (const model of models) {
    const existing = new Set(await listIndexNames(model));
    for (const spec of schemaIndexSpecs(model)) {
      if (!existing.has(spec.name)) missing.push(spec);
    }
  }
  return missing;
}

/**
 * Create every schema-declared index that is missing, one model at a time.
 * Never throws; see the module comment for the error policy.
 */
export async function ensureModelIndexes(
  models: AnyModel[],
  options: EnsureIndexesOptions = {}
): Promise<EnsureIndexesResult> {
  const result = emptyEnsureIndexesResult();
  const maxTimeMS = options.duplicateCheckMaxTimeMS ?? DEFAULT_DUPLICATE_CHECK_MAX_TIME_MS;

  for (const model of models) {
    const modelName = model.modelName;
    const collection = model.collection.name;

    let before: string[];
    try {
      before = await listIndexNames(model);
    } catch (err) {
      const error = errorMessage(err);
      logger.error('Failed to list indexes', { model: modelName, collection, error });
      result.failed.push({ model: modelName, collection, index: '*', error });
      continue;
    }
    const existing = new Set(before);

    for (const spec of schemaIndexSpecs(model)) {
      const label = `${collection}.${spec.name}`;
      if (existing.has(spec.name)) {
        result.existing.push(label);
        continue;
      }

      if (spec.unique) {
        try {
          const duplicates = await countDuplicateKeys(model, spec.keys, {
            sparse: spec.options.sparse === true,
            maxTimeMS,
          });
          if (duplicates.keys > 0) {
            const reason =
              `${duplicates.keys} duplicate key value(s), ${duplicates.extraDocuments} extra document(s); ` +
              'remove the duplicates before creating this unique index';
            logger.warn('Skipping unique index: duplicate keys exist', {
              model: modelName,
              collection,
              index: spec.name,
              keys: spec.keys,
              duplicateKeys: duplicates.keys,
              extraDocuments: duplicates.extraDocuments,
            });
            result.skipped.push({ model: modelName, collection, index: spec.name, reason });
            continue;
          }
        } catch (err) {
          const error = `duplicate check failed: ${errorMessage(err)}`;
          logger.error('Skipping unique index: duplicate check failed', {
            model: modelName,
            collection,
            index: spec.name,
            error,
          });
          result.failed.push({ model: modelName, collection, index: spec.name, error });
          continue;
        }
      }

      if (options.dryRun) {
        result.planned.push(label);
        continue;
      }

      try {
        await model.collection.createIndex(spec.keys as mongo.IndexSpecification, {
          ...(spec.options as mongo.CreateIndexesOptions),
          name: spec.name,
        });
        result.created.push(label);
        logger.info('Created index', {
          model: modelName,
          collection,
          index: spec.name,
          keys: spec.keys,
          unique: spec.unique,
        });
      } catch (err) {
        const code = errorCode(err);
        const error = errorMessage(err);
        const meta = { model: modelName, collection, index: spec.name, code, error };
        if (
          code === DUPLICATE_KEY ||
          code === INDEX_OPTIONS_CONFLICT ||
          code === INDEX_KEY_SPECS_CONFLICT
        ) {
          logger.warn('Index not created (duplicate key or conflicting definition)', meta);
        } else {
          logger.error('Index creation failed', meta);
        }
        result.failed.push({ model: modelName, collection, index: spec.name, error });
      }
    }

    if (!options.dryRun) {
      try {
        const after = await listIndexNames(model);
        logger.info('Index sync finished for collection', {
          model: modelName,
          collection,
          before: before.length,
          after: after.length,
          added: after.filter((name) => !existing.has(name)),
        });
      } catch {
        // The post-run listing is informational only.
      }
    }
  }

  return result;
}
