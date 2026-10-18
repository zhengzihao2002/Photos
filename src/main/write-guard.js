/**
 * write-guard.js  (M11) -- defence in depth for the promise "Photos never writes
 * to your photo folders".
 *
 * Loaded first in the main process and first in every worker thread. It wraps
 * the mutating functions of Node's `fs` and `fs/promises` (and createWriteStream)
 * so that:
 *   1. a target that resolves inside ANY registered source folder is refused;
 *   2. a target that resolves outside the allowed roots (the app's data folder,
 *      the app's temp folder, the OS temp folder, plus a short documented list) is
 *      refused as well.
 * "Resolves" means: made absolute, `..` removed, symbolic links followed (the real
 * path of the nearest existing ancestor is used), Unicode normalised (NFC) and
 * case-folded, because APFS is case-insensitive and normalisation-insensitive.
 * A refused call throws (sync), rejects (promise) or passes an error (callback)
 * with code EPHOTOSGUARD, and is logged and counted.
 *
 * What it cannot see: native code (SQLite, sharp/libvips, onnxruntime, Chromium) and
 * child processes. Their targets are fixed by this app (database and caches in the
 * data folder) or validated before spawning (safe-exec.js).
 *
 * Cheap: one realpath of an existing ancestor per mutating call, no caching of
 * answers, so a symlink swapped in later cannot be missed.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CODE = 'EPHOTOSGUARD';
const state = {
  installed: false,
  allowed: [],        // folded real paths
  sources: [],        // folded real paths
  violations: [],     // { op, target, reason }
  reporter: null,     // (violation) => void   (workers forward to the main thread)
  originals: {},
};

const realpath = fs.realpathSync.native || fs.realpathSync;

function fold(p) { return p.normalize('NFC').toLowerCase(); }

/** Real path of `p`, which may not exist: the real path of the nearest existing ancestor + the rest. */
function realOf(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      const real = realpath(cur);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch (e) {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function inside(foldedPath, foldedRoot) {
  return foldedPath === foldedRoot || foldedPath.startsWith(foldedRoot.endsWith(path.sep) ? foldedRoot : foldedRoot + path.sep);
}

/** Variants of a path to judge: following a final symlink, and not following it (unlink/rename act on the link itself). */
function variants(p) {
  const abs = path.resolve(p);
  const full = realOf(abs);
  const parentBased = path.join(realOf(path.dirname(abs)), path.basename(abs));
  return full === parentBased ? [full] : [full, parentBased];
}

/** { ok, reason } for writing to p. Exported for tests and for safe-exec.js. */
function check(p) {
  if (typeof p !== 'string' || p === '') return { ok: false, reason: 'not a path' };
  if (p.indexOf('\0') !== -1) return { ok: false, reason: 'NUL in path' };
  for (const v of variants(p)) {
    const f = fold(v);
    if (state.sources.some((s) => inside(f, s))) return { ok: false, reason: 'inside a source folder' };
    if (!state.allowed.some((a) => inside(f, a))) return { ok: false, reason: 'outside the app’s data and temp folders' };
  }
  return { ok: true };
}

function toPath(arg) {
  if (typeof arg === 'string') return arg;
  if (Buffer.isBuffer(arg)) return arg.toString('utf8');
  if (arg instanceof URL) return arg.protocol === 'file:' ? require('url').fileURLToPath(arg) : null;
  return null; // file descriptors, FileHandles: judged when they were opened
}

function violation(op, target, reason) {
  const v = { op, target: String(target), reason };
  state.violations.push(v);
  if (state.violations.length > 200) state.violations.shift();
  try { console.error('[write-guard] refused ' + op + ' ' + v.target + ' (' + reason + ')'); } catch (e) { /* ignore */ }
  if (state.reporter) { try { state.reporter(v); } catch (e) { /* ignore */ } }
  const err = new Error('Photos refused to ' + op + ' "' + v.target + '": ' + reason);
  err.code = CODE;
  return err;
}

function assertAllowed(op, arg) {
  const p = toPath(arg);
  if (p === null) return;
  const r = check(p);
  if (!r.ok) throw violation(op, p, r.reason);
}

const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;
function isWriteFlag(flags) {
  if (flags === undefined || flags === null) return false;
  if (typeof flags === 'number') return (flags & WRITE_FLAGS) !== 0;
  return /[wa+]/.test(String(flags));
}

// name -> which argument positions are paths that will be modified (relative to the argument list)
const PATH_ARGS = {
  writeFile: [0], appendFile: [0], truncate: [0], mkdir: [0], mkdtemp: [0], unlink: [0], rm: [0], rmdir: [0],
  utimes: [0], lutimes: [0], chmod: [0], lchmod: [0], chown: [0], lchown: [0],
  rename: [0, 1], copyFile: [1], cp: [1], symlink: [1], link: [1],
};

function guardArgs(name, args) {
  for (const i of PATH_ARGS[name]) assertAllowed(name, args[i]);
}

function wrapAll(target, label) {
  for (const name of Object.keys(PATH_ARGS)) {
    for (const variant of [name, name + 'Sync']) {
      const original = target[variant];
      if (typeof original !== 'function') continue;
      state.originals[label + '.' + variant] = original;
      const isSync = variant.endsWith('Sync');
      const isPromises = label === 'fs.promises';
      target[variant] = function guarded(...args) {
        try { guardArgs(name, args); } catch (err) {
          if (isSync) throw err;
          if (isPromises) return Promise.reject(err);
          const cb = args[args.length - 1];
          if (typeof cb === 'function') { process.nextTick(cb, err); return undefined; }
          throw err;
        }
        return original.apply(this, args);
      };
    }
  }
  // open / openSync / promises.open: judged only when opened for writing
  for (const variant of ['open', 'openSync']) {
    const original = target[variant];
    if (typeof original !== 'function') continue;
    state.originals[label + '.' + variant] = original;
    const isSync = variant === 'openSync';
    const isPromises = label === 'fs.promises';
    target[variant] = function guardedOpen(...args) {
      try {
        const flags = typeof args[1] === 'function' ? undefined : args[1];
        if (isWriteFlag(flags)) assertAllowed('open for writing', args[0]);
      } catch (err) {
        if (isSync) throw err;
        if (isPromises) return Promise.reject(err);
        const cb = args[args.length - 1];
        if (typeof cb === 'function') { process.nextTick(cb, err); return undefined; }
        throw err;
      }
      return original.apply(this, args);
    };
  }
}

function install(options = {}) {
  if (state.installed) { configure(options); return; }
  state.installed = true;
  configure(options);
  wrapAll(fs, 'fs');
  wrapAll(fs.promises, 'fs.promises');
  const createWriteStream = fs.createWriteStream;
  state.originals['fs.createWriteStream'] = createWriteStream;
  fs.createWriteStream = function guardedStream(file, ...rest) {
    assertAllowed('createWriteStream', file);
    return createWriteStream.call(this, file, ...rest);
  };
}

function configure({ allowedRoots, sourceRoots, reporter } = {}) {
  if (Array.isArray(allowedRoots)) state.allowed = allowedRoots.filter(Boolean).map((p) => fold(realOf(p)));
  if (Array.isArray(sourceRoots)) state.sources = sourceRoots.filter(Boolean).map((p) => fold(realOf(p)));
  if (typeof reporter === 'function') state.reporter = reporter;
}

/** Adds an allowed root (the explicit, documented allowlist: see docs/ZERO-WRITES-AUDIT.md). */
function allow(p) { if (p) state.allowed.push(fold(realOf(p))); }
function setSourceRoots(list) { configure({ sourceRoots: list }); }

/** What a worker thread needs to install the same guard. */
function workerConfig() {
  return { allowedRoots: state.allowed.slice(), sourceRoots: state.sources.slice() };
}

/**
 * Worker side. Call first thing in a worker file: require('../write-guard').installInWorker(workerData.guard).
 * Source folder changes arrive as { type: 'guard:source-roots', roots } messages from the main thread.
 * Short-lived workers (scan, size) pass { listen: false }: a message listener would keep a finished worker alive;
 * they get the list at start-up, which is current for their whole short life.
 */
function installInWorker(config, { listen = true } = {}) {
  if (!config) return;
  const { parentPort } = require('worker_threads');
  // Already folded real paths from the main thread: store as given.
  install({});
  state.allowed = (config.allowedRoots || []).slice();
  state.sources = (config.sourceRoots || []).slice();
  state.reporter = (v) => { if (parentPort) parentPort.postMessage({ type: 'guard:violation', violation: v }); };
  if (parentPort && listen) {
    parentPort.on('message', (msg) => {
      if (msg && msg.type === 'guard:source-roots' && Array.isArray(msg.roots)) state.sources = msg.roots.slice();
    });
  }
}

/** Main-thread side: keep long-lived workers' source lists current. */
const workers = new Set();
function registerWorker(w) { workers.add(w); w.once('exit', () => workers.delete(w)); }
function broadcastSourceRoots() {
  for (const w of workers) { try { w.postMessage({ type: 'guard:source-roots', roots: state.sources.slice() }); } catch (e) { /* worker gone */ } }
}

module.exports = {
  CODE, install, configure, allow, setSourceRoots, check, workerConfig, installInWorker,
  registerWorker, broadcastSourceRoots,
  getViolations: () => state.violations.slice(),
  isInstalled: () => state.installed,
  _state: state,
};
