/**
 * face-manager.js  (M10.3)
 *
 * Main-process side of face analysis. Spawns worker-faces.js, keeps it held
 * while a scan runs or thumbnails are being generated (checked once a second),
 * relays progress on the shared progress:update channel, restarts it after a
 * crash (up to 3 times), and stops it cleanly on quit.
 */

const { Worker } = require('worker_threads');
const path = require('path');
const paths = require('../paths');
const { modelsDir } = require('../resource-paths');
const { isScanRunning } = require('../index/scan-manager');
const thumbnailManager = require('../thumbnails/thumbnail-manager');

const TASK_ID = 'face-analysis';
const GATE_MS = 1000;
const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 2000;
const STOP_TIMEOUT_MS = 8000;

const bus = require('../window-bus'); // M8b.3

let worker = null;
let gateTimer = null;
let released = false;
let restarts = 0;
let stopRequested = false;
let stopWaiters = [];
let latest = { done: 0, total: 0, failed: 0, state: 'starting' };

// M8b.3: always the current window(s), never a reference kept from start().
function send(message) {
  bus.send('progress:update', { taskId: TASK_ID, ...message });
}

function report(state, msg) {
  latest = { done: msg.done, total: msg.total, failed: msg.failed, state };
  send({ current: msg.done + msg.failed, total: msg.total, errors: msg.failed, state });
}

/** Busy = a scan is running or the thumbnail queue still has work. */
function othersBusy() {
  if (isScanRunning()) return true;
  const t = thumbnailManager.getStatus();
  return t.running && t.current < t.total;
}

function gate() {
  if (worker == null) return;
  const shouldRun = othersBusy() === false;
  if (shouldRun === released) return;
  released = shouldRun;
  worker.postMessage({ type: shouldRun ? 'release' : 'hold' });
}

function settleStop() {
  stopWaiters.forEach((resolve) => resolve());
  stopWaiters = [];
}

function spawn() {
  released = false;
  worker = new Worker(path.join(__dirname, 'worker-faces.js'), {
    workerData: {
      dbPath: paths.dbPath(),
      modelDir: modelsDir(),
      tmpFolder: path.join(paths.tempDir(), 'faces'),
      thumbRoot: paths.thumbnailsDir(),
      logsDir: paths.logsDir(),
    },
  });
  worker.on('message', (msg) => {
    if (msg.type === 'started') { restarts = 0; report('waiting', msg); gate(); }
    else if (msg.type === 'progress') report('analyzing', msg);
    else if (msg.type === 'idle') report('idle', msg);
    // M10.6: people were regrouped; pages listening on progress:update refresh.
    else if (msg.type === 'people') send({ state: 'people', people: msg.people, clusters: msg.clusters });
    else if (msg.type === 'stopped') { report('stopped', msg); settleStop(); }
    else if (msg.type === 'fatal') { latest.state = 'failed'; send({ current: 0, total: 0, state: 'failed', message: msg.message }); }
  });
  worker.on('error', handleExit);
  worker.on('exit', handleExit);
}

function handleExit() {
  if (worker == null) return;
  worker = null;
  released = false;
  settleStop();
  if (stopRequested || restarts >= MAX_RESTARTS) return;
  restarts++;
  setTimeout(() => { if (worker == null && stopRequested === false) spawn(); }, RESTART_DELAY_MS);
}

// M8c.8 (C3): events go through window-bus; any window argument callers pass is ignored.
function start() {
  if (worker) return;
  stopRequested = false;
  restarts = 0;
  spawn();
  if (gateTimer == null) gateTimer = setInterval(gate, GATE_MS);
}

function stop() {
  clearInterval(gateTimer);
  gateTimer = null;
  if (worker == null) return Promise.resolve();
  stopRequested = true;
  const current = worker;
  const done = new Promise((resolve) => stopWaiters.push(resolve));
  current.postMessage({ type: 'stop' });
  const timeout = new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
  return Promise.race([done, timeout]).then(async () => {
    if (worker) { try { await current.terminate(); } catch (e) { /* already gone */ } }
    worker = null;
  });
}

/** M10.7: ask the worker to regroup people after a user correction (no-op if not running). */
function regroup() {
  if (worker) worker.postMessage({ type: 'regroup' });
}

function getStatus() {
  return { ...latest, running: worker !== null, released };
}

module.exports = { start, stop, getStatus, regroup, TASK_ID };
