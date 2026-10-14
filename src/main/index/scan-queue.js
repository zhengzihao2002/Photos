/**
 * scan-queue.js (M8b.2)
 *
 * The single place scans are requested. Runs one at a time in the main
 * process, independent of any window, and cannot get stuck: every run is
 * awaited inside try/finally and runScan always settles.
 *
 * Requests:  { sourceFolderId, kind: 'full' }
 *            { sourceFolderId, kind: 'dirs', dirs: [{ path, recursive }] }  (M8b.4;
 *            a bare path string means non-recursive)
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

const pending = new Map();   // sourceFolderId -> { kind, dirs: Map<path, recursive>|null }

// M8b.4: dirs entries are { path, recursive }; a bare string = non-recursive.
function normalizeDirs(list) {
  const out = [];
  for (const d of list || []) {
    if (typeof d === 'string' && d) out.push({ path: d, recursive: false });
    else if (d && typeof d.path === 'string' && d.path) out.push({ path: d.path, recursive: !!d.recursive });
  }
  return out;
}

function mergeDirs(map, list) {
  for (const d of list) map.set(d.path, map.get(d.path) === true || d.recursive);
}

// Drop entries already covered by a recursive ancestor entry.
function pruneDirs(map) {
  const recursiveRoots = Array.from(map).filter(([, r]) => r).map(([p]) => p);
  const out = [];
  for (const [p, r] of map) {
    const covered = recursiveRoots.some((root) => root !== p && p.startsWith(root.endsWith('/') ? root : root + '/'));
    if (!covered) out.push({ path: p, recursive: r });
  }
  return out;
}
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
  const dirs = kind === 'dirs' ? normalizeDirs(request.dirs) : null;
  if (kind === 'dirs' && dirs.length === 0) return { queued: false, reason: 'no directories' };

  const existing = pending.get(id);
  let coalesced = false;
  if (!existing) {
    let map = null;
    if (dirs) { map = new Map(); mergeDirs(map, dirs); }
    pending.set(id, { kind, dirs: map });
    order.push(id);
  } else {
    coalesced = true;
    if (existing.kind === 'full') {
      // already covers everything
    } else if (kind === 'full') {
      existing.kind = 'full';
      existing.dirs = null;
    } else {
      mergeDirs(existing.dirs, dirs);
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
      dirs: req.kind === 'dirs' ? pruneDirs(req.dirs) : undefined,
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
