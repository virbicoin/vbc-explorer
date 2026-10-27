/**
 * Backward-compatible alias for `models/index.ts`.
 *
 * Every Mongoose model, interface and index is defined in models/index.ts (the
 * single source of truth for schemas and collection names). This module only
 * re-exports it; import from `@/models/index` in new code.
 */
export * from '../models/index';
