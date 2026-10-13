/**
 * thumbnail-writes.js  (write side)
 *
 * Records thumbnail job state in the items table. Reads live in
 * thumbnail-db.js.
 *
 * claim(job): marks every requested size 'pending' in ONE transaction. If
 * any size cannot be claimed (already pending or done, or the row is
 * deleted) the whole claim rolls back and false is returned.
 *
 * recordResult(job, result): buffers the outcome of generateThumbnails and
 * flushes automatically at batchSize entries. flush() applies everything
 * in one transaction and returns [{ id, size }] for thumbnails that really
 * became ready.
 *
 * Outcome per size: a size that finished -> 'done' (error text cleared); an
 * environment failure (source_missing, permission_denied, read_failed,
 * write_failed) -> released back to NULL so a later run retries; any other
 * failure -> 'error' with "code: message".
 *
 * Every write is guarded by "AND status = 'pending'". If the source file
 * changed mid-job, the migration-6 trigger has already reset the row to
 * NULL, so the stale result is discarded and the item is regenerated. If
 * the row was removed mid-job (source:remove), the write changes nothing.
 * If a flush fails, its entries go back into the buffer and the error is
 * rethrown.
 */

const { ENVIRONMENT_CODES } = require('./queue-core');

const SIZES = ['sm', 'md'];
const RELEASE_CODES = new Set([...ENVIRONMENT_CODES, 'write_failed']);
const MAX_ERROR_LENGTH = 300;

function createThumbnailWrites(db, { batchSize = 50 } = {}) {
  const claimStmts = {};
  const finishStmts = {};
  const forceReleaseStmts = {};
  for (const size of SIZES) {
    const col = 'thumb_' + size + '_status';
    claimStmts[size] = db.prepare(
      `UPDATE items SET ${col} = 'pending' WHERE id = ? AND is_deleted = 0 AND ${col} IS NULL`
    );
    finishStmts[size] = {
      done: db.prepare(`UPDATE items SET ${col} = 'done', thumb_error = NULL WHERE id = ? AND ${col} = 'pending'`),
      error: db.prepare(`UPDATE items SET ${col} = 'error', thumb_error = ? WHERE id = ? AND ${col} = 'pending'`),
      release: db.prepare(`UPDATE items SET ${col} = NULL WHERE id = ? AND ${col} = 'pending'`),
    };
    forceReleaseStmts[size] = db.prepare(`UPDATE items SET ${col} = NULL WHERE id = ?`);
  }

  const NOT_CLAIMED = new Error('not claimed');
  const claimTxn = db.transaction((job) => {
    for (const size of job.sizes) {
      if (claimStmts[size].run(job.id).changes !== 1) throw NOT_CLAIMED;
    }
  });

  function claim(job) {
    try {
      claimTxn(job);
      return true;
    } catch (err) {
      if (err === NOT_CLAIMED) return false;
      throw err;
    }
  }

  function outcomesFor(job, result) {
    const made = result.sizes || {};
    return job.sizes.map((size) => {
      if (result.ok || made[size]) return { size, kind: 'done' };
      if (RELEASE_CODES.has(result.code)) return { size, kind: 'release' };
      const text = (result.code + ': ' + String(result.message || '')).slice(0, MAX_ERROR_LENGTH);
      return { size, kind: 'error', text };
    });
  }

  let buffer = [];

  const applyTxn = db.transaction((entries) => {
    const ready = [];
    for (const { id, outcomes } of entries) {
      // 'done' first, so a later error text on the other size is not cleared by it
      const ordered = [...outcomes.filter((o) => o.kind === 'done'), ...outcomes.filter((o) => o.kind !== 'done')];
      for (const o of ordered) {
        const stmts = finishStmts[o.size];
        if (o.kind === 'done') {
          if (stmts.done.run(id).changes === 1) ready.push({ id, size: o.size });
        } else if (o.kind === 'error') {
          stmts.error.run(o.text, id);
        } else {
          stmts.release.run(id);
        }
      }
    }
    return ready;
  });

  function flush() {
    if (buffer.length === 0) return [];
    const entries = buffer;
    buffer = [];
    try {
      return applyTxn(entries);
    } catch (err) {
      buffer = entries.concat(buffer);
      throw err;
    }
  }

  function recordResult(job, result) {
    buffer.push({ id: job.id, outcomes: outcomesFor(job, result) });
    return buffer.length >= batchSize ? flush() : null;
  }

  function forceRelease(id, size) {
    forceReleaseStmts[size].run(id);
  }

  return { claim, recordResult, flush, forceRelease, bufferedCount: () => buffer.length };
}

module.exports = { createThumbnailWrites, RELEASE_CODES };
