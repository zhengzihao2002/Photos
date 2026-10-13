/**
 * worker-faces.js  (M10.3)
 *
 * Worker Thread that owns the face-analysis queue and its own database
 * connection. One photo at a time, only while the manager allows it.
 * workerData: { dbPath, modelDir, tmpFolder, thumbRoot, logsDir }
 * Messages in: release, hold, stop. Out: started, progress, idle, stopped, fatal.
 * Errors go to <logsDir>/faces.log (rotated at startup past 2 MB).
 */

process.env.ORT_DISABLE_TELEMETRY = '1'; // before anything loads the runtime

const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const sharp = require('sharp');
const { openWorkerConnection } = require('../index/worker-db');
const thumbPaths = require('../thumbnails/thumbnail-paths');
const { PIPELINE_VERSION, loadModels, analyzeImage } = require('./face-analyze');
const { createFaceDb } = require('./face-db');
const { runPeoplePass } = require('../people/people-pass');

const { dbPath, modelDir, tmpFolder, thumbRoot, logsDir } = workerData;
const BATCH = 50;
const POLL_MS = 10000;
const PROGRESS_MS = 500;
const LOG_FILE = path.join(logsDir, 'faces.log');

sharp.concurrency(1);
sharp.cache(false);

let db, faceDb, models, pollTimer;
let held = true, stopping = false, running = false, wantPass = true;
let peopleDirty = true, lastSig = ''; // M10.5: regroup once at launch, then whenever faces change
let lastProgress = 0;
const unreachable = new Set();
const post = (msg) => parentPort.postMessage(msg);

function log(level, message) {
  try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + level + ' ' + message + '\n'); } catch (e) { /* never break the queue */ }
}

function sendProgress(force) {
  const now = Date.now();
  if (force || now - lastProgress >= PROGRESS_MS) {
    lastProgress = now;
    post({ type: 'progress', ...faceDb.getCounts() });
  }
}

async function refreshFolders() {
  for (const row of db.prepare('SELECT id, root_path FROM source_folders').all()) {
    let ok = false;
    try { ok = (await fs.promises.stat(row.root_path)).isDirectory(); } catch (e) { /* unreachable */ }
    if (ok) unreachable.delete(row.id); else unreachable.add(row.id);
  }
}

async function analyzeOne(item) {
  const isVideo = item.media_type === 'video';
  const mdPath = item.thumb_md_status === 'done' ? thumbPaths.absolutePath(thumbRoot, item.id, 'md') : null;
  // M10.7: videos are analysed from their poster-frame thumbnail only (md if made, else sm),
  // never from the video file.
  const posterPath = isVideo ? (mdPath || thumbPaths.absolutePath(thumbRoot, item.id, 'sm')) : null;
  const result = await analyzeImage({
    models,
    sourcePath: isVideo ? posterPath : path.join(item.root_path, item.relative_path),
    extension: isVideo ? 'jpg' : item.extension,
    mdPath, tmpFolder, id: item.id,
  });
  if (result.ok) {
    if (faceDb.writeResult(item, result.faces)) peopleDirty = true;
    else log('INFO', 'item ' + item.id + ' changed during analysis; will redo');
  } else {
    const counted = faceDb.recordFailure(item.id, result.code);
    log(counted ? 'ERROR' : 'WARN', 'item ' + item.id + ' ' + result.code + ': ' + result.message);
  }
}

/** Cheap fingerprint of visible faces: changes when scans delete items or folders are removed. */
function facesSig() {
  const r = db.prepare('SELECT COUNT(*) AS n, IFNULL(MAX(f.id), 0) AS m FROM faces f JOIN items i ON i.id = f.item_id WHERE i.is_deleted = 0').get();
  return r.n + ':' + r.m;
}

/** Groups faces into people when anything changed (database only, inside this thread). */
function runPeopleIfNeeded() {
  if (peopleDirty === false) return;
  try {
    let r = runPeoplePass(db);
    if (r.retry) r = runPeoplePass(db);
    if (r.retry) { log('INFO', 'people pass deferred: corrections in progress'); return; }
    peopleDirty = false;
    lastSig = facesSig();
    log('INFO', 'people pass: ' + JSON.stringify(r));
    post({ type: 'people', ...r });
  } catch (err) { log('ERROR', 'people pass failed: ' + err.message); }
}

/** One pass over everything still waiting. Stops early on hold or stop. */
async function runPass() {
  if (running || stopping) return;
  running = true;
  wantPass = false;
  let afterId = 0;
  try {
    for (;;) {
      if (held || stopping) { wantPass = true; break; }
      const batch = faceDb.fetchBatch(afterId, BATCH, [...unreachable]);
      if (batch.length === 0) { runPeopleIfNeeded(); sendProgress(true); post({ type: 'idle', ...faceDb.getCounts() }); break; }
      for (const item of batch) {
        if (held || stopping) { wantPass = true; break; }
        afterId = item.id;
        try { await analyzeOne(item); } catch (err) { log('ERROR', 'item ' + item.id + ' unexpected: ' + err.message); }
        sendProgress(false);
      }
    }
  } finally {
    running = false;
  }
}

async function heartbeat() {
  if (stopping) return;
  try { await refreshFolders(); } catch (err) { log('ERROR', 'folder check failed: ' + err.message); }
  try { if (facesSig() !== lastSig) peopleDirty = true; } catch (err) { log('ERROR', 'face check failed: ' + err.message); }
  wantPass = true;
  if (held === false) runPass();
}

function handleMessage(msg) {
  if (msg == null || stopping) return;
  if (msg.type === 'stop') { shutdown(); return; }
  if (msg.type === 'hold') { held = true; return; }
  if (msg.type === 'regroup') { // M10.7: after a user correction
    peopleDirty = true;
    wantPass = true;
    if (running === false && held === false) runPeopleIfNeeded();
    return;
  }
  if (msg.type === 'release') {
    held = false;
    if (wantPass) runPass();
  }
}

async function shutdown() {
  stopping = true;
  clearInterval(pollTimer);
  while (running) await new Promise((r) => setTimeout(r, 50)); // finish the current photo
  let counts = {};
  try { counts = faceDb.getCounts(); db.pragma('wal_checkpoint(PASSIVE)'); db.close(); } catch (err) { log('ERROR', 'close failed: ' + err.message); }
  post({ type: 'stopped', ...counts });
  parentPort.close();
}

async function startup() {
  try {
    try { if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch (e) { /* no log yet */ }
    fs.mkdirSync(tmpFolder, { recursive: true });
    db = openWorkerConnection(dbPath);
    faceDb = createFaceDb(db, PIPELINE_VERSION);
    const reset = faceDb.resetOldVersions();
    models = await loadModels(modelDir);
    await refreshFolders();
    pollTimer = setInterval(heartbeat, POLL_MS);
    parentPort.on('message', handleMessage);
    log('INFO', 'worker started: pipeline ' + PIPELINE_VERSION + ', reset ' + reset + ' rows');
    post({ type: 'started', pipelineVersion: PIPELINE_VERSION, reset, ...faceDb.getCounts() });
  } catch (err) {
    log('FATAL', 'startup failed: ' + err.message);
    post({ type: 'fatal', message: err.message });
    try { if (db) db.close(); } catch (e) { /* already broken */ }
    parentPort.close();
  }
}

startup();
