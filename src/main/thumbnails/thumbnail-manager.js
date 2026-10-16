/**
 * thumbnail-manager.js
 *
 * Main-process counterpart to scan-manager.js. Spawns the thumbnail worker,
 * restarts it on a crash (up to 3 times), forwards its progress onto the
 * existing progress:update channel, and exposes prioritize()/stop() for the
 * IPC handlers in M2.7.
 *
 * Only one worker runs at a time. start() is idempotent: calling it again
 * while a worker is already running does nothing.
 */

const { Worker } = require('worker_threads');
const path = require('path');
const paths = require('../paths');

const CONCURRENCY = 3;
const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 2000;
const STOP_TIMEOUT_MS = 5000;
const TASK_ID = 'thumbnail-generation';
const bus = require('../window-bus'); // M8b.3

let worker = null;
let restarts = 0;
let stopRequested = false;
let latestSnapshot = { current: 0, total: 0, errors: 0, message: null };
let stopWaiters = [];

// M8b.3: always the current window(s), never a reference kept from start().
function send(message) {
  bus.send('progress:update', { taskId: TASK_ID, ...message });
}

function snapshotFrom(msg) {
  return { current: msg.current, total: msg.total, errors: msg.errors };
}

function spawn() {
  worker = new Worker(path.join(__dirname, 'worker-thumbnails.js'), {
    workerData: {
      dbPath: paths.dbPath(),
      thumbRoot: paths.thumbnailsDir(),
      logsDir: paths.logsDir(),
      concurrency: CONCURRENCY,
    },
  });

  worker.on('message', (msg) => {
    if (msg.type === 'started' || msg.type === 'progress' || msg.type === 'idle') {
      restarts = 0;
      latestSnapshot = snapshotFrom(msg);
      send({ current: msg.current, total: msg.total, errors: msg.errors, message: msg.type === 'idle' ? 'Thumbnails up to date' : undefined });
    } else if (msg.type === 'paused') {
      send({ current: latestSnapshot.current, total: latestSnapshot.total, errors: latestSnapshot.errors, message: 'Thumbnail generation paused: ' + msg.reason });
    } else if (msg.type === 'stopped') {
      latestSnapshot = snapshotFrom(msg);
      settleStop();
    } else if (msg.type === 'fatal') {
      settleStop();
      worker = null;
    }
    // 'ready' messages are available here for M2.7 to forward to the renderer.
  });

  worker.on('error', () => { handleUnexpectedExit(); });
  worker.on('exit', () => { handleUnexpectedExit(); });
}

function settleStop() {
  stopWaiters.forEach((resolve) => resolve());
  stopWaiters = [];
}

function handleUnexpectedExit() {
  const wasStopping = stopRequested;
  worker = null;
  settleStop();
  if (wasStopping) return;
  if (restarts >= MAX_RESTARTS) return;
  restarts++;
  setTimeout(() => { if (!worker && !stopRequested) spawn(); }, RESTART_DELAY_MS);
}

// M8c.8 (C3): events go through window-bus; any window argument callers pass is ignored.
function start() {
  if (worker) return;
  stopRequested = false;
  restarts = 0;
  spawn();
}

function prioritize(ids, size) {
  if (worker) worker.postMessage({ type: 'prioritize', ids, size });
}

function regenerate(id, size) {
  if (worker) worker.postMessage({ type: 'regenerate', id, size });
}

function stop() {
  if (!worker) return Promise.resolve();
  stopRequested = true;
  const done = new Promise((resolve) => stopWaiters.push(resolve));
  worker.postMessage({ type: 'stop' });
  const timeout = new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
  return Promise.race([done, timeout]).then(() => { worker = null; });
}

function getStatus() {
  return { ...latestSnapshot, running: worker !== null };
}

module.exports = { start, prioritize, regenerate, stop, getStatus };
