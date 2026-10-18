/**
 * storage.js (M8c.6) -- the Settings > Storage view: sizes and safe clearing.
 *
 * Sizes are measured in worker-size.js (off the main thread), cached 15 s.
 * Clearing deletes ONLY inside a known cache folder under the data root
 * (resolved, symlinks included); never library.db, config.json, or anything
 * outside the data root. Each clear asks first (native dialog), pauses the
 * worker that writes there, deletes, resets any database flags that say a
 * cached file exists, resumes, and tells windows ('storage:cleared').
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Worker } = require('worker_threads');
const { app, session, dialog } = require('electron');
const paths = require('../paths');
const db = require('../index/db');
const bus = require('../window-bus');
const { t } = require('../i18n'); // M14

const WEB_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary'];
const CACHE_MS = 15000;
const TEMP_MIN_AGE_MS = 60 * 60 * 1000;
let cached = null; // { at, result }
let busy = false;

function rootFolder() { return app.isPackaged ? path.dirname(paths.dataRoot()) : app.getAppPath(); }
function appPaths() {
  if (app.isPackaged) return [path.resolve(app.getAppPath(), '..', '..', '..')]; // Photos.app
  const data = path.resolve(paths.dataRoot());
  return fs.readdirSync(rootFolder()).map((n) => path.join(rootFolder(), n)).filter((p) => path.resolve(p) !== data);
}
function libraryPaths() {
  const root = paths.dataRoot();
  return fs.readdirSync(root).filter((n) => /^library\.db/.test(n)).map((n) => path.join(root, n));
}

const ROWS = [
  { key: 'app', paths: appPaths },
  { key: 'library', paths: libraryPaths },
  { key: 'thumbnails', paths: () => [paths.thumbnailsDir()], clear: 'thumbnails' },
  { key: 'previews', paths: () => [paths.displayCacheDir()], clear: 'previews' },
  { key: 'faceCrops', paths: () => [paths.faceCropsDir()], clear: 'faceCrops' },
  { key: 'webCache', paths: () => WEB_CACHE_DIRS.map((d) => path.join(paths.electronDataDir(), d)), clear: 'webCache' },
  { key: 'logs', paths: () => [paths.logsDir(), paths.tempDir(), paths.crashDumpsDir()], clear: 'logs' },
];

function runWorker(jobs) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'worker-size.js'), { workerData: { jobs, freeSpacePath: paths.dataRoot() } });
    w.once('message', resolve);
    w.once('error', reject);
    w.once('exit', (code) => { if (code !== 0) reject(new Error('size worker exited ' + code)); });
  });
}

async function getSizes({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  const jobs = [{ key: 'total', paths: [rootFolder()] }].concat(ROWS.map((r) => ({ key: r.key, paths: r.paths() })));
  const m = await runWorker(jobs);
  const rows = ROWS.map((r) => ({ key: r.key, bytes: m.sizes[r.key] || 0, clear: r.clear || null }));
  const other = Math.max(0, (m.sizes.total || 0) - rows.reduce((a, r) => a + r.bytes, 0));
  rows.push({ key: 'other', bytes: other, clear: null });
  const result = { total: m.sizes.total || 0, rows, freeBytes: m.freeBytes, ms: m.ms };
  cached = { at: Date.now(), result };
  return result;
}

// Deletes the CONTENTS of a cache folder; refuses anything not strictly inside the data root.
async function emptyDir(dir, { minAgeMs = 0 } = {}) {
  const root = fs.realpathSync(paths.dataRoot());
  const real = fs.realpathSync(dir);
  if (!real.startsWith(root + path.sep) || real === fs.realpathSync(path.dirname(paths.dbPath()))) {
    throw new Error('storage: refusing to clear outside a cache folder: ' + real);
  }
  const now = Date.now();
  for (const name of await fsp.readdir(real)) {
    const p = path.join(real, name);
    if (minAgeMs > 0) {
      try { if (now - (await fsp.lstat(p)).mtimeMs < minAgeMs) continue; } catch (e) { continue; }
    }
    await fsp.rm(p, { recursive: true, force: true });
  }
}

const CLEARERS = {
  async thumbnails() {
    const tm = require('../thumbnails/thumbnail-manager');
    await tm.stop();
    try {
      await emptyDir(paths.thumbnailsDir());
      db.get().prepare('UPDATE items SET thumb_sm_status = NULL, thumb_md_status = NULL, thumb_error = NULL').run();
    } finally { tm.start({}); }
  },
  async previews() { await require('../display/display-cache').clearAll(); },
  async faceCrops() {
    const fm = require('../faces/face-manager');
    await fm.stop();
    try { await emptyDir(paths.faceCropsDir()); } finally { fm.start({}); }
  },
  async webCache() {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({});
  },
  async logs() {
    await emptyDir(paths.logsDir());
    await emptyDir(paths.crashDumpsDir());
    await emptyDir(paths.tempDir(), { minAgeMs: TEMP_MIN_AGE_MS });
  },
};

const CONFIRM_KINDS = ['thumbnails', 'previews', 'faceCrops', 'webCache', 'logs', 'all'];

async function clear(kind, parentWindow) {
  if (!CONFIRM_KINDS.includes(kind)) throw new Error('storage: unknown clear kind ' + kind);
  if (busy) return { ok: false, reason: 'busy' };
  const message = t('storage.confirm.' + kind + '.message');
  const detail = t('storage.confirm.' + kind + '.detail');
  const res = await dialog.showMessageBox(parentWindow || undefined, {
    type: 'warning', buttons: [t('storage.confirm.clear'), t('storage.confirm.cancel')], defaultId: 1, cancelId: 1, message, detail,
  });
  if (res.response !== 0) return { ok: false, reason: 'cancelled' };
  busy = true;
  try {
    const kinds = kind === 'all' ? Object.keys(CLEARERS) : [kind];
    for (const k of kinds) await CLEARERS[k]();
  } finally { busy = false; cached = null; }
  bus.send('storage:cleared', { kind });
  return { ok: true, sizes: await getSizes({ force: true }) };
}

module.exports = { getSizes, clear };
