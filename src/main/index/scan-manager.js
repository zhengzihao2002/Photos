/**
 * scan-manager.js
 *
 * Owns spawning the scan worker thread and relaying its progress onto the
 * app's existing progress:update channel (reserved by M0, unused until
 * now). Only one scan runs at a time; a second start request while one is
 * already running is rejected rather than silently queued or ignored.
 */

const { Worker } = require('worker_threads');
const path = require('path');
const { geoDatasetPath } = require('../resource-paths');

let activeWorker = null;

function isScanRunning() {
  return activeWorker !== null;
}

function startScan({ dbPath, sourceFolderId, sourceRootPath, mainWindow }) {
  if (activeWorker) {
    return { started: false, reason: 'A scan is already running' };
  }

  const taskId = `scan-${sourceFolderId}-${Date.now()}`;

  const worker = new Worker(path.join(__dirname, 'worker-scan.js'), {
    // M7.3: the worker cannot ask Electron where resources live, so the
    // resolved dataset path travels with the other spawn-time data.
    workerData: { dbPath, sourceFolderId, sourceRootPath, taskId, geoDatasetPath: geoDatasetPath() },
  });

  activeWorker = worker;

  function send(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress:update', payload);
    }
  }

  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      send({ taskId: msg.taskId, current: msg.current, total: msg.total, message: msg.message });
    } else if (msg.type === 'done') {
      send({ taskId: msg.taskId, current: msg.total, total: msg.total, message: 'Scan complete' });
      activeWorker = null;
    } else if (msg.type === 'missing') {
      send({ taskId: msg.taskId, current: 0, total: 0, message: 'Source folder not found' });
      activeWorker = null;
    } else if (msg.type === 'fatal') {
      send({ taskId: msg.taskId, current: 0, total: 0, message: `Scan failed: ${msg.message}` });
      activeWorker = null;
    }
  });

  worker.on('error', () => {
    activeWorker = null;
  });

  worker.on('exit', () => {
    activeWorker = null;
  });

  return { started: true, taskId };
}

module.exports = { startScan, isScanRunning };
