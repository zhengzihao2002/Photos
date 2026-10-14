/**
 * worker-scan.js
 *
 * Runs inside a Node Worker Thread — its own event loop within the same
 * process, so better-sqlite3's synchronous calls block only this thread,
 * never the main process or the renderer. Deliberately has no access to
 * Electron's `app` or any browser-process API; everything it needs
 * (database path, source folder id and root) arrives via workerData at
 * spawn time, and all progress goes out via parentPort.postMessage, never
 * a direct call back into the main thread.
 *
 * Missing-folder guard: if the source root isn't reachable at all (e.g. an
 * external drive that's unplugged), the scan does not run — no item is
 * touched, no deletion sweep happens. Only the source_folders row itself is
 * marked 'missing'. This is deliberate: treating "can't see the folder" the
 * same as "everything in it was deleted" would tombstone an entire external
 * drive's worth of items the moment it's unplugged.
 *
 * Deletion sweep ordering: a file can only be proven deleted once the
 * ENTIRE scan finishes without its row being touched — mid-scan there is no
 * way to distinguish "deleted" from "this file's directory hasn't been
 * reached yet." The sweep therefore runs exactly once, after the full
 * directory walk completes, comparing each row's updated_at against the
 * timestamp captured before the scan began.
 */

const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const { openWorkerConnection } = require('./worker-db');
const { createUpsertStatements } = require('./upsert-item');
const { discoverFiles, discoverFilesByDirectory, isHidden, isBundleDirectory } = require('./discover');
const { processDirectoryBatch } = require('./scan-directory-batch');
const { markMissing, markScanned } = require('./source-folders');
const { createReverseGeocoder } = require('../places/reverse-geocode');
const { runPlacePass } = require('../places/place-pass');

// M8b.6: the app's own folders (from the main process) are never walked.
const EXCLUDE = (workerData && Array.isArray(workerData.protectedRoots)) ? workerData.protectedRoots : [];
const isExcludedPath = (p) => EXCLUDE.some((e) => p === e || p.startsWith(e + path.sep));

async function isReachableDirectory(rootPath) {
  try {
    const stat = await fs.promises.stat(rootPath);
    return stat.isDirectory();
  } catch (err) {
    return false;
  }
}

async function countTotalFiles(rootPath) {
  let count = 0;
  for await (const file of discoverFiles(rootPath, { exclude: EXCLUDE })) {
    count += 1;
  }
  return count;
}

// M7.3: place names are a convenience, never a reason to fail a scan. A
// missing dataset or any error skips the pass; its transaction rolls back
// and the same rows are retried on the next scan.
function runPlacePassSafely(db, datasetPath) {
  if (!datasetPath) return { skipped: 'no dataset path' };
  try {
    return runPlacePass(db, createReverseGeocoder(datasetPath));
  } catch (err) {
    return { skipped: err.message };
  }
}

async function run() {
  const { dbPath, sourceFolderId, sourceRootPath, taskId, geoDatasetPath } = workerData;
  // M8b.4: a request limited to some directories takes the scoped path.
  if (Array.isArray(workerData.dirs) && workerData.dirs.length > 0) return runScoped();
  const scanStartedAt = Math.floor(Date.now() / 1000);

  const reachable = await isReachableDirectory(sourceRootPath);
  if (!reachable) {
    const db = openWorkerConnection(dbPath);
    markMissing(db, sourceFolderId, scanStartedAt);
    db.pragma('wal_checkpoint(PASSIVE)');
    db.close();
    parentPort.postMessage({ type: 'missing', taskId, sourceFolderId });
    return;
  }

  const total = await countTotalFiles(sourceRootPath);
  parentPort.postMessage({ type: 'progress', taskId, current: 0, total, message: 'Starting scan' });

  const db = openWorkerConnection(dbPath);
  const stmts = createUpsertStatements(db);

  const aggregate = { inserted: 0, updated: 0, unchanged: 0, errors: 0 };
  const allErrors = [];
  let processed = 0;

  try {
    // M8b.2 (F11): collect walk errors; an unreadable directory blocks the sweep.
    const walkErrors = [];
    for await (const group of discoverFilesByDirectory(sourceRootPath, { errors: walkErrors, exclude: EXCLUDE })) {
      const { summary, errors } = await processDirectoryBatch({
        db,
        stmts,
        sourceFolderId,
        sourceRootPath,
        files: group.files,
      });

      aggregate.inserted += summary.inserted;
      aggregate.updated += summary.updated;
      aggregate.unchanged += summary.unchanged;
      aggregate.errors += summary.errors;
      allErrors.push(...errors);

      processed += group.files.length;
      parentPort.postMessage({
        type: 'progress',
        taskId,
        current: processed,
        total,
        message: group.dirPath,
      });
    }

    const now = Math.floor(Date.now() / 1000);

    // M8b.2 (F11): unreadable is never deleted. If the root vanished during
    // the walk (drive unplugged, folder moved) or any directory could not be
    // read, rows not seen this scan are NOT tombstoned.
    if (!(await isReachableDirectory(sourceRootPath))) {
      markMissing(db, sourceFolderId, now);
      db.pragma('wal_checkpoint(PASSIVE)');
      db.close();
      parentPort.postMessage({ type: 'missing', taskId, sourceFolderId });
      return;
    }
    const dirErrors = walkErrors.filter((e) => e.kind === 'dir');
    if (dirErrors.length > 0) {
      aggregate.deleted = 0;
      aggregate.sweepSkipped = { unreadableDirs: dirErrors.length, first: dirErrors[0].path, code: dirErrors[0].code };
    } else {
      aggregate.deleted = stmts.sweepDeletions(sourceFolderId, scanStartedAt, now);
    }
    allErrors.push(...walkErrors);

    // M7.3: fill place names for new, changed, and not-yet-computed rows.
    aggregate.places = runPlacePassSafely(db, geoDatasetPath);

    markScanned(db, sourceFolderId, now);

    db.pragma('wal_checkpoint(PASSIVE)');
    db.close();

    parentPort.postMessage({ type: 'done', taskId, total, summary: aggregate, errors: allErrors });
  } catch (err) {
    try {
      db.close();
    } catch (closeErr) {
      // already broken; nothing more to do
    }
    parentPort.postMessage({ type: 'fatal', taskId, message: err.message });
  }
}

/**
 * M8b.4: scoped scan. Same per-directory processing as a full scan, limited
 * to the requested directories, with a deletion sweep limited to them.
 * dirs: [{ path, recursive }] (a bare string means non-recursive).
 * Sweep per directory: all read -> sweep it; the directory itself is gone
 * (ENOENT) -> vanished, sweep its whole subtree; any other error -> no sweep.
 */
function normalizeScopedEntries(dirs, sourceRootPath) {
  const seen = new Map();
  for (const d of dirs) {
    const p = typeof d === 'string' ? d : (d && d.path);
    if (typeof p !== 'string' || !p) continue;
    const rel = path.relative(sourceRootPath, p);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) continue;
    const segs = rel ? rel.split(path.sep) : [];
    if (segs.some((x) => isHidden(x) || isBundleDirectory(x))) continue;
    if (isExcludedPath(path.join(sourceRootPath, ...segs))) continue;
    const key = segs.join('/');
    const recursive = !!(d && typeof d === 'object' && d.recursive);
    const prev = seen.get(key);
    seen.set(key, { abs: path.join(sourceRootPath, ...segs), rel: key, recursive: recursive || (prev ? prev.recursive : false) });
  }
  return Array.from(seen.values());
}

async function runScoped() {
  const { dbPath, sourceFolderId, sourceRootPath, taskId, geoDatasetPath, dirs } = workerData;
  // updated_at has 1-second resolution: start on a fresh second so rows
  // touched by a scan that ended this same second still count as 'before'.
  await new Promise((r) => setTimeout(r, 1005 - (Date.now() % 1000)));
  const scanStartedAt = Math.floor(Date.now() / 1000);

  if (!(await isReachableDirectory(sourceRootPath))) {
    const db = openWorkerConnection(dbPath);
    markMissing(db, sourceFolderId, scanStartedAt);
    db.pragma('wal_checkpoint(PASSIVE)');
    db.close();
    parentPort.postMessage({ type: 'missing', taskId, sourceFolderId });
    return;
  }

  const entries = normalizeScopedEntries(dirs, sourceRootPath);
  parentPort.postMessage({ type: 'progress', taskId, current: 0, total: 0, message: 'Starting scan' });
  const db = openWorkerConnection(dbPath);
  const stmts = createUpsertStatements(db);
  const aggregate = { inserted: 0, updated: 0, unchanged: 0, errors: 0, scoped: entries.length };
  const allErrors = [];
  const outcomes = [];
  let processed = 0;

  try {
    for (const e of entries) {
      const walkErrors = [];
      for await (const group of discoverFilesByDirectory(e.abs, { recursive: e.recursive, errors: walkErrors, exclude: EXCLUDE })) {
        const { summary, errors } = await processDirectoryBatch({
          db, stmts, sourceFolderId, sourceRootPath, files: group.files,
        });
        aggregate.inserted += summary.inserted;
        aggregate.updated += summary.updated;
        aggregate.unchanged += summary.unchanged;
        aggregate.errors += summary.errors;
        allErrors.push(...errors);
        processed += group.files.length;
        parentPort.postMessage({ type: 'progress', taskId, current: processed, total: processed, message: group.dirPath });
      }
      const dirErrs = walkErrors.filter((x) => x.kind === 'dir');
      let mode = 'sweep';
      if (dirErrs.length === 1 && dirErrs[0].code === 'ENOENT' && dirErrs[0].path === e.abs) mode = 'vanished';
      else if (dirErrs.length > 0) mode = 'skip';
      outcomes.push({ e, mode });
      allErrors.push(...walkErrors);
    }

    const now = Math.floor(Date.now() / 1000);
    if (!(await isReachableDirectory(sourceRootPath))) {
      markMissing(db, sourceFolderId, now);
      db.pragma('wal_checkpoint(PASSIVE)');
      db.close();
      parentPort.postMessage({ type: 'missing', taskId, sourceFolderId });
      return;
    }

    let deleted = 0;
    const skipped = [];
    for (const o of outcomes) {
      if (o.mode === 'skip') { skipped.push(o.e.rel || '(root)'); continue; }
      const recursive = o.mode === 'vanished' ? true : o.e.recursive;
      deleted += stmts.sweepDeletionsScoped(sourceFolderId, o.e.rel, recursive, scanStartedAt, now);
    }
    aggregate.deleted = deleted;
    if (skipped.length) aggregate.sweepSkipped = { unreadableDirs: skipped.length, first: skipped[0] };
    aggregate.vanished = outcomes.filter((o) => o.mode === 'vanished').length;

    aggregate.places = runPlacePassSafely(db, geoDatasetPath);
    markScanned(db, sourceFolderId, now);
    db.pragma('wal_checkpoint(PASSIVE)');
    db.close();
    parentPort.postMessage({ type: 'done', taskId, total: processed, summary: aggregate, errors: allErrors });
  } catch (err) {
    try { db.close(); } catch (closeErr) { /* already broken */ }
    parentPort.postMessage({ type: 'fatal', taskId, message: err.message });
  }
}

run();
