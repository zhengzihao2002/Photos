/**
 * scan-manager.js
 *
 * Runs ONE scan worker and reports on it. Policy (ordering, coalescing,
 * what to scan next) lives in scan-queue.js; nothing else should call
 * runScan directly.
 *
 * M8b.2: runScan returns a promise that ALWAYS settles, whatever the worker
 * does (done / missing / fatal / thrown error / exit without a message), and
 * every outcome emits a terminal progress:update, so neither the queue nor
 * the renderer can be left waiting. Progress goes through window-bus, so it
 * reaches whichever window is open now (or is dropped if none is).
 */

const { Worker } = require('worker_threads');
const path = require('path');
const { geoDatasetPath } = require('../resource-paths');
const bus = require('../window-bus');
const paths = require('../paths'); // M8b.6

let activeWorker = null;

function isScanRunning() {
  return activeWorker !== null;
}

/**
 * @param {{dbPath:string, sourceFolderId:number, sourceRootPath:string, dirs?:string[]}} job
 * @returns {Promise<{status:'done'|'missing'|'failed', taskId:string, summary?:object,
 *                    errors?:object[], message?:string}>}
 */
function runScan({ dbPath, sourceFolderId, sourceRootPath, dirs }) {
  if (activeWorker) {
    // Only reachable if something bypasses scan-queue; fail loudly but settle.
    return Promise.resolve({ status: 'failed', taskId: null, message: 'A scan is already running' });
  }

  const taskId = `scan-${sourceFolderId}-${Date.now()}`;

  return new Promise((resolve) => {
    let settled = false;
    let worker;

    function finish(result, terminalMessage) {
      if (settled) return;
      settled = true;
      activeWorker = null;
      bus.send('progress:update', {
        taskId,
        current: result.total || 0,
        total: result.total || 0,
        message: terminalMessage,
        sourceFolderId,
      });
      resolve({ taskId, ...result });
    }

    try {
      worker = new Worker(path.join(__dirname, 'worker-scan.js'), {
        workerData: {
          dbPath, sourceFolderId, sourceRootPath, taskId,
          dirs: Array.isArray(dirs) ? dirs : null,
          geoDatasetPath: geoDatasetPath(),
          protectedRoots: paths.protectedRoots(), // M8b.6: never indexed
        },
      });
    } catch (err) {
      finish({ status: 'failed', message: err.message }, `Scan failed: ${err.message}`);
      return;
    }

    activeWorker = worker;

    worker.on('message', (msg) => {
      if (!msg || settled) return;
      if (msg.type === 'progress') {
        bus.send('progress:update', {
          taskId, current: msg.current, total: msg.total, message: msg.message, sourceFolderId,
        });
      } else if (msg.type === 'done') {
        finish({ status: 'done', total: msg.total, summary: msg.summary, errors: msg.errors }, 'Scan complete');
      } else if (msg.type === 'missing') {
        finish({ status: 'missing' }, 'Source folder not found');
      } else if (msg.type === 'fatal') {
        finish({ status: 'failed', message: msg.message }, `Scan failed: ${msg.message}`);
      }
    });

    worker.on('error', (err) => {
      finish({ status: 'failed', message: err && err.message }, `Scan failed: ${err && err.message}`);
    });

    worker.on('exit', (code) => {
      // Normal exits arrive after a terminal message (already settled).
      finish({ status: 'failed', message: `worker exited (${code})` }, `Scan failed: worker exited (${code})`);
    });
  });
}

/** Quit path: stop a running worker. Each directory is one transaction, so
 *  an interrupted scan rolls back cleanly; the next launch catches up. */
function terminate() {
  const w = activeWorker;
  if (!w) return Promise.resolve();
  return w.terminate().then(() => {}, () => {});
}

module.exports = { runScan, isScanRunning, terminate };
