/**
 * Total document counts without a filter.
 *
 * countDocuments with an empty filter walks every entry of the `_id` index: on the
 * 3.2-million-row Block collection that took more than a second per request
 * and made /api/v2/blocks the slowest endpoint of the explorer even when idle.
 * `estimatedDocumentCount()` reads the count from the collection metadata in
 * constant time. It can be off by a few hundred documents after an unclean
 * shutdown until the next checkpoint, which is fine for pagination hints and
 * dashboard totals.
 *
 * Rules (the `no-restricted-syntax` ESLint rule rejects countDocuments calls
 * with no argument or an empty object in app/, lib/, models/ and tools/):
 * - an unfiltered total goes through countAll();
 * - a filtered count keeps `countDocuments(filter)`: estimatedDocumentCount()
 *   accepts no filter and must never replace one;
 * - a place that truly needs an exact total says why in a comment and keeps
 *   the empty-filter countDocuments call behind an eslint-disable line.
 * estimatedDocumentCount() is not allowed inside multi-document transactions;
 * this code base does not use them.
 */

/** A Mongoose model or a native driver collection. */
export interface CountableCollection {
  estimatedDocumentCount(): PromiseLike<number>;
}

/** Number of documents in the collection, from its metadata (no scan). */
export async function countAll(target: CountableCollection): Promise<number> {
  const count = await target.estimatedDocumentCount();
  return Number(count) || 0;
}
