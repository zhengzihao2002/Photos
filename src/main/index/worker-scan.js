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
const { parentPort, workerData } = require('worker_threads');
const { openWorkerConnection } = require('./worker-db');
const { createUpsertStatements } = require('./upsert-item');
const { discoverFiles, discoverFilesByDirectory } = require('./discover');
const { processDirectoryBatch } = require('./scan-directory-batch');
const { markMissing, markScanned } = require('./source-folders');
const { createReverseGeocoder } = require('../places/reverse-geocode');
const { runPlacePass } = require('../places/place-pass');

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
  for await (const file of discoverFiles(rootPath)) {
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
    for await (const group of discoverFilesByDirectory(sourceRootPath)) {
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
    const deletedCount = stmts.sweepDeletions(sourceFolderId, scanStartedAt, now);
    aggregate.deleted = deletedCount;

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

run();
