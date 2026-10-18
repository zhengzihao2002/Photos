/**
 * folder-watcher.js (M8b.5)
 *
 * Watches every reachable source folder (fs.watch recursive = macOS FSEvents,
 * no dependency) and turns bursts of changes into scoped scans on the
 * main-process scan queue. Observes only; never writes to source folders.
 *
 * Debounce: flush after QUIET_MS without events, at most MAX_WAIT_MS after
 * the first. Copy in progress: a size+mtime signature is taken twice,
 * STABLE_MS apart; anything still changing waits for the next round.
 * Unwatchable sources (network filesystems, watcher errors) get a full
 * incremental scan every FALLBACK_MS instead.
 */

const fs = require('fs');
const path = require('path');
const { safeExecFile: execFile } = require('../safe-exec'); // M11
const db = require('./db');
const scanQueue = require('./scan-queue');
const ev = require('./watch-events');
const paths = require('../paths'); // M8b.6

const QUIET_MS = 2000;
const MAX_WAIT_MS = 10000;
const STABLE_MS = 2000;
const FALLBACK_MS = 10 * 60 * 1000;
const NETWORK_FS = new Set(['smbfs', 'nfs', 'afpfs', 'webdav', 'cifs', 'ftp']);

const entries = new Map(); // sourceFolderId -> entry
// M8b.6: events from the app's own folders are dropped on arrival, so its
// own writes can never trigger scans (refreshed on every refresh()).
let excluded = [];
const isExcluded = (p) => excluded.some((e) => p === e || p.startsWith(e + path.sep));
let stopped = false;
let refreshChain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mountTable() {
  return new Promise((resolve) => {
    execFile('/sbin/mount', [], { timeout: 5000 }, (err, out) => resolve(err ? '' : String(out)));
  });
}

/** Filesystem type of the mount containing root, from `mount` output lines
 *  like "//host/share on /Volumes/share (smbfs, nodev, ...)". */
function fsTypeFor(root, table) {
  let best = null;
  for (const line of table.split('\n')) {
    const m = line.match(/ on (.+) \(([^,)]+)/);
    if (!m) continue;
    const mp = m[1];
    const inside = root === mp || root.startsWith(mp.endsWith('/') ? mp : mp + '/');
    if (inside && (!best || mp.length > best.mp.length)) best = { mp, type: m[2] };
  }
  return best ? best.type : null;
}

function schedule(entry) {
  clearTimeout(entry.quietTimer);
  const now = Date.now();
  if (!entry.firstAt) entry.firstAt = now;
  const wait = Math.min(QUIET_MS, Math.max(0, entry.firstAt + MAX_WAIT_MS - now));
  entry.quietTimer = setTimeout(() => flush(entry), wait);
}

function onEvent(entry, name) {
  if (stopped || entries.get(entry.id) !== entry) return;
  if (name == null) { entry.buf.add(entry.root); schedule(entry); return; }
  const rel = String(name);
  if (ev.isIgnoredRelative(rel)) return;
  const abs = path.join(entry.root, rel);
  if (isExcluded(abs)) return;
  entry.buf.add(abs);
  schedule(entry);
}

async function flush(entry) {
  if (entries.get(entry.id) !== entry) return;
  if (entry.flushing) { schedule(entry); return; }
  entry.flushing = true;
  const paths = Array.from(entry.buf);
  entry.buf.clear();
  entry.firstAt = 0;
  try {
    if ((await ev.classify(entry.root)) !== 'dir') {
      stopOne(entry.id);
      scanQueue.enqueue({ sourceFolderId: entry.id, kind: 'full' });
      return;
    }
    const items = [];
    for (const p of paths) {
      if (p === entry.root) continue;
      items.push({ p, kind: await ev.classify(p) });
    }
    const checked = items.filter((x) => x.kind === 'media' || x.kind === 'dir');
    for (const x of checked) x.sig = await ev.signature(x.p, x.kind);
    if (checked.length) await sleep(STABLE_MS);
    let held = 0;
    for (const x of checked) {
      if ((await ev.signature(x.p, x.kind)) !== x.sig) { x.held = true; held += 1; entry.buf.add(x.p); }
    }
    const scopes = items.filter((x) => !x.held).flatMap((x) => ev.scopesFor(x.p, x.kind));
    if (scopes.length) scanQueue.enqueue({ sourceFolderId: entry.id, kind: 'dirs', dirs: scopes });
  } catch (err) {
    console.warn('watcher flush failed:', err.message);
  } finally {
    entry.flushing = false;
    if (entry.buf.size && entries.get(entry.id) === entry) schedule(entry);
  }
}

function usePolling(entry, why) {
  if (entry.watcher) { try { entry.watcher.close(); } catch (e) { /* already closed */ } entry.watcher = null; }
  if (entry.pollTimer) return;
  console.warn('Folder watcher: polling', entry.root, 'every 10 min:', why);
  entry.mode = 'poll';
  entry.pollTimer = setInterval(() => scanQueue.enqueue({ sourceFolderId: entry.id, kind: 'full' }), FALLBACK_MS);
}

function startOne(row, table) {
  const entry = { id: row.id, root: row.root_path, buf: new Set(), quietTimer: null, firstAt: 0,
    flushing: false, watcher: null, pollTimer: null, mode: 'watch' };
  entries.set(row.id, entry);
  const type = fsTypeFor(row.root_path, table);
  if (type && NETWORK_FS.has(type)) { usePolling(entry, 'network fs ' + type); return; }
  try {
    entry.watcher = fs.watch(row.root_path, { recursive: true }, (t, name) => onEvent(entry, name));
    entry.watcher.on('error', (err) => usePolling(entry, err && err.message));
  } catch (err) {
    usePolling(entry, err.message);
  }
}

function stopOne(id) {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  clearTimeout(entry.quietTimer);
  clearInterval(entry.pollTimer);
  if (entry.watcher) { try { entry.watcher.close(); } catch (e) { /* already closed */ } }
}

/** Sync watchers with source_folders: watch every 'ok' and reachable source. */
function refresh() {
  refreshChain = refreshChain.then(async () => {
    if (stopped) return;
    try { excluded = paths.protectedRoots(); } catch (err) { /* keep previous list */ }
    const rows = db.get().prepare('SELECT id, root_path, status FROM source_folders').all();
    const table = await mountTable();
    const ids = new Set(rows.map((r) => r.id));
    for (const id of Array.from(entries.keys())) if (!ids.has(id)) stopOne(id);
    for (const row of rows) {
      const reachable = row.status === 'ok' && (await ev.classify(row.root_path)) === 'dir';
      const cur = entries.get(row.id);
      if (!reachable) { if (cur) stopOne(row.id); continue; }
      if (cur && cur.root === row.root_path) continue;
      if (cur) stopOne(row.id);
      startOne(row, table);
    }
  }).catch((err) => console.warn('watcher refresh failed:', err.message));
  return refreshChain;
}

/** Launch: changes made while the app was closed. Unchanged files are skipped;
 *  an unreachable source is simply marked missing by the worker. */
function reconcileAtLaunch() {
  const rows = db.get().prepare('SELECT id FROM source_folders ORDER BY added_at').all();
  for (const r of rows) scanQueue.enqueue({ sourceFolderId: r.id, kind: 'full' });
}

function stopAll() {
  stopped = true;
  for (const id of Array.from(entries.keys())) stopOne(id);
}

module.exports = { refresh, reconcileAtLaunch, stopAll };
