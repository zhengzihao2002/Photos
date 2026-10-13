/**
 * worker-thumbnails.js
 *
 * Runs in a Worker Thread: owns the thumbnail queue and its own database
 * connection, so better-sqlite3's synchronous calls never block the main
 * process. No Electron access; everything arrives via workerData
 * { dbPath, thumbRoot, logsDir, concurrency }.
 *
 * Startup: reset leftover 'pending' rows, empty <root>/.tmp, find which
 * source folders are reachable (unreachable ones are set aside and never
 * recorded as errors), then start the background lane. A 10 s heartbeat
 * re-checks folders, refreshes counts and wakes the queue for new work.
 *
 * Messages out: started, progress, ready, idle, paused, resumed, stopped,
 *   fatal. Messages in: prioritize { ids, size }, stop.
 * Errors go to <logsDir>/thumbnails.log (rotated at startup past 2 MB).
 */

const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');
const { openWorkerConnection } = require('../index/worker-db');
const { createQueue } = require('./queue-core');
const { createThumbnailReads } = require('./thumbnail-db');
const { createThumbnailWrites, RELEASE_CODES } = require('./thumbnail-writes');
const { generateThumbnails } = require('./generate');
const thumbPaths = require('./thumbnail-paths');
const { sweepOrphans } = require('./orphan-sweep');

const { dbPath, thumbRoot, logsDir } = workerData;
const CONCURRENCY = workerData.concurrency || 3;
const TICK_MS = 250;
const POLL_MS = 10000;
const RESUME_AFTER_PAUSE_MS = 60000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_WARN_LINES = 200;
const LOG_FILE = path.join(logsDir, 'thumbnails.log');

sharp.concurrency(1); // parallel jobs x one libvips thread each, not one per core

let db, reads, writes, queue, tickTimer, pollTimer, resumeTimer;
let base = { total: 0, done: 0, errors: 0 };
let delta = { done: 0, errors: 0 };
let readyBatch = [];
let lastSent = '';
let warnLines = 0;
let sweptOrphans = false;
let polling = false;
let stopping = false;
const unreachable = new Set();
const post = (msg) => parentPort.postMessage(msg);

function log(level, message) {
  try {
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + level + ' ' + message + '\n');
  } catch (err) { /* logging must never break the queue */ }
}

/** Progress: last database count plus what has finished since. */
function snapshot() {
  const current = base.done + base.errors + delta.done + delta.errors;
  return { current, total: Math.max(base.total, current), errors: base.errors + delta.errors };
}

function flushWrites() {
  try {
    const ready = writes.flush();
    if (ready.length) readyBatch.push(...ready);
  } catch (err) { log('ERROR', 'flush failed: ' + err.message); }
}

/** Flush first, so the database count includes everything finished so far. */
function refreshCounts() {
  flushWrites();
  base = reads.getCounts([...unreachable]);
  delta = { done: 0, errors: 0 };
}

function tick() {
  flushWrites();
  if (readyBatch.length) { post({ type: 'ready', items: readyBatch }); readyBatch = []; }
  const snap = snapshot();
  const key = snap.current + '/' + snap.total + '/' + snap.errors;
  if (key !== lastSent) { lastSent = key; post({ type: 'progress', ...snap }); }
}

/** Folder status in the database can be stale, so check each root directly. */
async function refreshFolders() {
  const rows = db.prepare('SELECT id, root_path FROM source_folders').all();
  const present = new Set(rows.map((r) => r.id));
  for (const row of rows) {
    let reachable = false;
    try { reachable = (await fs.promises.stat(row.root_path)).isDirectory(); } catch (err) { /* unreachable */ }
    if (!reachable && !unreachable.has(row.id)) {
      unreachable.add(row.id);
      queue.setAsideFolder(row.id);
      log('WARN', 'source folder ' + row.id + ' unreachable; its items are set aside');
    } else if (reachable && unreachable.has(row.id)) {
      unreachable.delete(row.id);
      queue.restoreFolder(row.id);
      log('INFO', 'source folder ' + row.id + ' reachable again');
    }
  }
  for (const id of [...unreachable]) {
    if (!present.has(id)) { unreachable.delete(id); queue.restoreFolder(id); } // removed via source:remove
  }
}

function onResult(job, result) {
  if (job.sizes.includes('sm')) {
    if (result.ok || (result.sizes && result.sizes.sm)) delta.done++;
    else if (!RELEASE_CODES.has(result.code)) delta.errors++;
  }
  if (!result.ok) {
    const soft = RELEASE_CODES.has(result.code);
    if (!soft || warnLines++ < MAX_WARN_LINES) {
      log(soft ? 'WARN' : 'ERROR', 'item ' + job.id + ' ' + result.code + ': ' +
        String(result.message).replace(/\s+/g, ' ').slice(0, 200) + ' [' + job.sourcePath + ']');
    }
  }
  const ready = writes.recordResult(job, result);
  if (ready) readyBatch.push(...ready);
}

function processJob(job) {
  return generateThumbnails({
    thumbRoot, sourcePath: job.sourcePath, id: job.id, extension: job.extension,
    sizes: job.sizes, durationSeconds: job.durationSeconds,
  });
}

/* ---- part 2: startup, heartbeat, messages, shutdown ---- */

const MAX_PRIORITY_IDS = 500;

function prepareFiles() {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch (err) { /* no log yet */ }
  const tmp = thumbPaths.tmpDir(thumbRoot);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
}

async function heartbeat() {
  if (polling || stopping) return;
  polling = true;
  try {
    await refreshFolders();
    refreshCounts();
    queue.wake();
  } catch (err) { log('ERROR', 'heartbeat failed: ' + err.message); }
  polling = false;
}

function handleMessage(msg) {
  if (!msg || stopping) return;
  if (msg.type === 'stop') { shutdown(); return; }
  if (msg.type === 'prioritize') {
    try {
      const size = msg.size === 'md' ? 'md' : 'sm';
      const ids = (Array.isArray(msg.ids) ? msg.ids : []).slice(0, MAX_PRIORITY_IDS);
      queue.setForeground(reads.jobsForIds(ids, size));
    } catch (err) { log('ERROR', 'prioritize failed: ' + err.message); }
  } else if (msg.type === 'regenerate') {
    try {
      const size = msg.size === 'md' ? 'md' : 'sm';
      writes.forceRelease(msg.id, size);
      queue.unblock(msg.id);
      queue.setForeground(reads.jobsForIds([msg.id], size));
    } catch (err) { log('ERROR', 'regenerate failed: ' + err.message); }
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(tickTimer);
  clearInterval(pollTimer);
  clearTimeout(resumeTimer);
  try { await queue.stop(); } catch (err) { log('ERROR', 'stop failed: ' + err.message); }
  tick();
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
    db.close();
  } catch (err) { log('ERROR', 'db close failed: ' + err.message); }
  post({ type: 'stopped', ...snapshot() });
  parentPort.close();
}

async function startup() {
  try {
    db = openWorkerConnection(dbPath);
    reads = createThumbnailReads(db);
    writes = createThumbnailWrites(db);
    const reset = reads.resetPending();
    prepareFiles();
    queue = createQueue({
      concurrency: CONCURRENCY,
      fetchBackground: (after, limit, excluded) => reads.fetchBackground(after, limit, excluded),
      claim: (job) => writes.claim(job),
      process: processJob,
      onResult,
      onIdle: () => {
        refreshCounts();
        if (!sweptOrphans) {
          sweptOrphans = true;
          try { sweepOrphans(db, thumbRoot, log); } catch (err) { log('ERROR', 'orphan sweep failed: ' + err.message); }
        }
        tick();
        post({ type: 'idle', ...snapshot() });
      },
      onPause: (reason) => {
        log('ERROR', 'queue paused: ' + reason + ' (thumbnail folder not writable, or disk full?)');
        post({ type: 'paused', reason });
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => {
          if (!stopping) { queue.resume(); post({ type: 'resumed' }); }
        }, RESUME_AFTER_PAUSE_MS);
      },
      onError: (err) => log('ERROR', 'queue: ' + ((err && err.message) || err)),
    });
    await refreshFolders();
    refreshCounts();
    log('INFO', 'worker started: reset ' + reset + ' pending, concurrency ' + CONCURRENCY);
    tickTimer = setInterval(tick, TICK_MS);
    pollTimer = setInterval(heartbeat, POLL_MS);
    parentPort.on('message', handleMessage);
    post({ type: 'started', resetPending: reset, concurrency: CONCURRENCY, ...snapshot() });
    queue.wake();
  } catch (err) {
    log('FATAL', 'startup failed: ' + err.message);
    post({ type: 'fatal', message: err.message });
    try { if (db) db.close(); } catch (closeErr) { /* already broken */ }
    parentPort.close();
  }
}

startup();
