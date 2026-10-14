/**
 * scan-queue.js (M8b.2)
 *
 * The single place scans are requested. Runs one at a time in the main
 * process, independent of any window, and cannot get stuck: every run is
 * awaited inside try/finally and runScan always settles.
 *
 * Requests:  { sourceFolderId, kind: 'full' }
 *            { sourceFolderId, kind: 'dirs', dirs: [absolute dir paths] }   (M8b.4)
 * Coalescing (per source, while waiting): repeats are absorbed; 'full'
 * absorbs any 'dirs'; 'dirs' sets merge. A source that is RUNNING may also
 * hold one pending request, so changes made after its scan began are seen.
 * The root path is read from the database when the scan starts, so a queued
 * request never scans a stale path after a relink; a removed source is
 * skipped.
 */

const db = require('./db');
const paths = require('../paths');
const scanManager = require('./scan-manager');
const bus = require('../window-bus');

const pending = new Map();   // sourceFolderId -> { kind, dirs:Set|null }
const order = [];            // sourceFolderIds, FIFO
let running = null;          // { sourceFolderId, kind }
let stopped = false;
let pumpScheduled = false;
const finishedListeners = new Set();

function getState() {
  return {
    running: running ? running.sourceFolderId : null,
    runningKind: running ? running.kind : null,
    pending: order.slice(),
  };
}

function broadcastState() {
  bus.send('scan:queue-state', getState());
}

function enqueue(request) {
  if (stopped) return { queued: false, reason: 'shutting down' };
  const id = Number(request && request.sourceFolderId);
  if (!Number.isInteger(id) || id <= 0) return { queued: false, reason: 'invalid sourceFolderId' };
  const kind = request.kind === 'dirs' ? 'dirs' : 'full';
  const dirs = kind === 'dirs' ? (request.dirs || []).filter((d) => typeof d === 'string' && d) : null;
  if (kind === 'dirs' && dirs.length === 0) return { queued: false, reason: 'no directories' };

  const existing = pending.get(id);
  let coalesced = false;
  if (!existing) {
    pending.set(id, { kind, dirs: dirs ? new Set(dirs) : null });
    order.push(id);
  } else {
    coalesced = true;
    if (existing.kind === 'full') {
      // already covers everything
    } else if (kind === 'full') {
      existing.kind = 'full';
      existing.dirs = null;
    } else {
      dirs.forEach((d) => existing.dirs.add(d));
    }
  }
  broadcastState();
  schedulePump();
  return { queued: true, coalesced };
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  setImmediate(() => { pumpScheduled = false; pump(); });
}

function lookupRoot(sourceFolderId) {
  try {
    const row = db.get().prepare('SELECT root_path FROM source_folders WHERE id = ?').get(sourceFolderId);
    return row ? row.root_path : null;
  } catch (err) {
    return null;
  }
}

async function pump() {
  if (stopped || running || order.length === 0) return;
  const sourceFolderId = order.shift();
  const req = pending.get(sourceFolderId);
  pending.delete(sourceFolderId);

  const rootPath = lookupRoot(sourceFolderId);
  if (!rootPath) { broadcastState(); schedulePump(); return; } // removed meanwhile

  running = { sourceFolderId, kind: req.kind };
  console.log('[M8b-diag] scan start', sourceFolderId, req.kind, 'pending after:', order.join(',') || '-'); // M8b.9: remove
  broadcastState();
  let result = { status: 'failed', message: 'not run' };
  try {
    result = await scanManager.runScan({
      dbPath: paths.dbPath(),
      sourceFolderId,
      sourceRootPath: rootPath,
      dirs: req.kind === 'dirs' ? Array.from(req.dirs) : undefined,
    });
  } catch (err) {
    result = { status: 'failed', message: err && err.message };
  } finally {
    const finished = running;
    console.log('[M8b-diag] scan end', finished.sourceFolderId, result.status, result.summary ? JSON.stringify({ d: result.summary.deleted, skip: result.summary.sweepSkipped || null }) : (result.message || '')); // M8b.9: remove
    running = null;
    broadcastState();
    for (const fn of finishedListeners) {
      try { fn({ ...finished, result }); } catch (e) { /* listener bugs never stall the queue */ }
    }
    schedulePump();
  }
}

function onScanFinished(fn) {
  finishedListeners.add(fn);
  return () => finishedListeners.delete(fn);
}

function shutdown() {
  stopped = true;
  pending.clear();
  order.length = 0;
  return scanManager.terminate();
}

module.exports = { enqueue, getState, onScanFinished, shutdown };
