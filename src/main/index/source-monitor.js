/**
 * source-monitor.js (M8b.7)
 *
 * Notices, on its own, a source folder disappearing (deleted, renamed,
 * moved, drive unplugged) or coming back. Checks every INTERVAL_MS and when
 * the Mac wakes or unlocks: one async stat per source root.
 *
 *   reachable -> unreachable: status 'missing', watcher stopped, windows told.
 *                             Nothing is scanned or swept (data is kept).
 *   unreachable -> reachable: status 'ok', watcher restarted, a full
 *                             incremental scan queued, windows told.
 *
 * Transitions are judged against this module's own last observation, not
 * the database status (source:list also rewrites status when the sidebar
 * loads, which would otherwise hide a return).
 */

const fs = require('fs');
const db = require('./db');
const scanQueue = require('./scan-queue');
const bus = require('../window-bus');

const INTERVAL_MS = 10000;
const lastSeen = new Map(); // sourceFolderId -> boolean reachable
let timer = null;
let checking = false;
let stopped = false;
const diag = (...a) => console.log('[M8b-diag]', ...a); // M8b.9: remove

async function isReachable(rootPath) {
  try { return (await fs.promises.stat(rootPath)).isDirectory(); } catch (err) { return false; }
}

async function checkNow(reason) {
  if (stopped || checking) return;
  checking = true;
  try {
    const rows = db.get().prepare('SELECT id, root_path, status FROM source_folders').all();
    const ids = new Set(rows.map((r) => r.id));
    for (const id of Array.from(lastSeen.keys())) if (!ids.has(id)) lastSeen.delete(id);

    const changes = [];
    for (const row of rows) {
      const now = await isReachable(row.root_path);
      const before = lastSeen.has(row.id) ? lastSeen.get(row.id) : row.status === 'ok';
      lastSeen.set(row.id, now);
      const wantStatus = now ? 'ok' : 'missing';
      if (row.status !== wantStatus) {
        db.get().prepare('UPDATE source_folders SET status = ?, last_checked_at = ? WHERE id = ?')
          .run(wantStatus, Math.floor(Date.now() / 1000), row.id);
      }
      if (now === before && row.status === wantStatus) continue;
      changes.push({ sourceFolderId: row.id, status: wantStatus });
      if (now && !before) scanQueue.enqueue({ sourceFolderId: row.id, kind: 'full' });
    }

    if (changes.length > 0) {
      diag('source status', reason, JSON.stringify(changes));
      require('./folder-watcher').refresh();
      bus.send('source:status-changed', changes);
    }
  } catch (err) {
    console.warn('source check failed:', err.message);
  } finally {
    checking = false;
  }
}

function start() {
  stopped = false;
  if (timer) return;
  timer = setInterval(() => checkNow('interval'), INTERVAL_MS);
  try {
    const { powerMonitor } = require('electron');
    powerMonitor.on('resume', () => setTimeout(() => checkNow('resume'), 2000));
    powerMonitor.on('unlock-screen', () => checkNow('unlock'));
  } catch (err) { /* not available: the interval still runs */ }
  checkNow('start');
}

function stop() {
  stopped = true;
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, checkNow };
