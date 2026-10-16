/**
 * paths.js
 *
 * Resolves every location the app is allowed to write to. This is the single
 * source of truth for "where does our data live" — no other file in the app
 * should build one of these paths itself.
 *
 * DESIGN GOAL: portability. The whole app (code + data) must be movable to a
 * different folder, or a different Mac, and keep working with zero absolute
 * paths persisted anywhere (except user-chosen source folders, which live
 * outside the app on purpose — see config.js).
 *
 * ── Where should writable data live, relative to a .app bundle? ──────────
 *
 * Three options were considered for the *production* (packaged) case:
 *
 * 1. Inside the .app bundle itself (e.g. Contents/Resources/data).
 *    Rejected. The bundle is treated as a signed, immutable unit by macOS.
 *    Even though this build is unsigned, writing inside Contents/* is fragile:
 *    - If the app is ever signed/notarized later, writes inside the bundle
 *      invalidate the signature and Gatekeeper will refuse to launch it.
 *    - Apps are commonly run straight from a read-only medium (a mounted
 *      .dmg, a read-only network share); the bundle itself may not be
 *      writable at all regardless of signing.
 *    - Mixing user data into the bundle also means "reinstalling" the app
 *      (replacing the .app) silently destroys the library.
 *
 * 2. ~/Library/Application Support/Photos (the normal macOS convention).
 *    Rejected for THIS project specifically, because the spec requires the
 *    entire app — including the database and thumbnail cache — to live
 *    inside one folder that can be copied to another Mac and keep working.
 *    A path under the user's home directory is exactly the kind of
 *    machine-specific absolute path that breaks portability.
 *
 * 3. A plain folder that sits NEXT TO the .app bundle (chosen).
 *    The install unit becomes: [SomeFolder]/Photos.app +
 *    [SomeFolder]/PhotosData/. Copy SomeFolder anywhere — another disk,
 *    another Mac — and both the app and its data move together. Nothing
 *    about the path is hardcoded to a machine, a user account, or a fixed
 *    disk location; it's always computed from "where am I right now."
 *
 * Caveat (recorded here, repeated in the return handoff): if the user
 * launches Photos.app directly from a mounted .dmg (read-only) without
 * dragging it out first, sibling-folder creation will fail (EROFS). This is
 * normal Mac app behavior — nearly all Mac apps require this same first step
 * — but M0 detects it and fails with a clear message rather than crashing
 * silently or writing somewhere unexpected. See main.js.
 *
 * ── Dev vs. production ─────────────────────────────────────────────────
 *
 * In development (`./dev start`, running from source), there is no .app
 * bundle. We instead use a `.dev-data` folder inside the project root
 * (app.getAppPath() reliably points at the project root when not packaged).
 * `.dev-data` is git-ignored and never shipped.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Walks up from the Electron executable path to find the folder that
 * *contains* the .app bundle, e.g.:
 *   .../Photos.app/Contents/MacOS/Photos   (exe)
 *   .../Photos.app/Contents/MacOS                (dirname x1)
 *   .../Photos.app/Contents                      (dirname x2)
 *   .../Photos.app                               (dirname x3)
 *   .../ <-- this is what we want                     (dirname x4)
 */
function getAppBundleParentDir() {
  const exePath = app.getPath('exe');
  return path.dirname(path.dirname(path.dirname(path.dirname(exePath))));
}

function getDataRoot() {
  if (app.isPackaged) {
    return path.join(getAppBundleParentDir(), 'PhotosData');
  }
  // Dev mode: app.getAppPath() is the project root (folder containing package.json).
  return path.join(app.getAppPath(), '.dev-data');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

let cachedRoot = null;

/** Absolute path to the app's data root. Created on first access. */
function dataRoot() {
  if (!cachedRoot) {
    cachedRoot = getDataRoot();
    ensureDir(cachedRoot);
  }
  return cachedRoot;
}

/** Path to the SQLite index file. (M1 creates the actual database.) */
function dbPath() {
  return path.join(dataRoot(), 'library.db');
}

/** Directory for generated thumbnails. Created on first access. */
function thumbnailsDir() {
  return ensureDir(path.join(dataRoot(), 'thumbnails'));
}

/**
 * Directory for full-quality display derivatives (M5): JPEGs decoded on
 * demand for formats Chromium can't render (HEIC/HEIF/RAW/TIFF). Kept
 * separate from thumbnails/ so M2's orphan sweep and .tmp cleanup never
 * touch it, and so it can have its own size budget. Created on first access.
 */
function displayCacheDir() {
  return ensureDir(path.join(dataRoot(), 'display-cache'));
}

/** Path to the JSON config file. */
function configPath() {
  return path.join(dataRoot(), 'config.json');
}

/** Directory for log files. Created on first access. */
function logsDir() {
  return ensureDir(path.join(dataRoot(), 'logs'));
}

/**
 * M8a: Electron's own storage (network cache, GPU caches, cookies). Electron
 * creates the folder itself; main.js points 'userData' and 'sessionData' here.
 */
function electronDataDir() {
  return path.join(dataRoot(), 'electron-data');
}

/**
 * M8a: the app's temp folder, used instead of the system temp folder by
 * Electron, worker threads, and child processes (sips, ffmpeg). Disposable:
 * main.js empties it at launch. Created on first access.
 */
function tempDir() {
  return ensureDir(path.join(dataRoot(), 'tmp'));
}

/**
 * M10: portrait crops of people's cover faces for the People page, named
 * <faceId>.jpg (a new cover is a new file). Disposable cache: rebuilt on
 * demand, deleted with all face data. Created on first access.
 */
function faceCropsDir() {
  return ensureDir(path.join(dataRoot(), 'face-crops'));
}

/** M8a: Electron crash dumps. Created on first access. */
function crashDumpsDir() {
  return ensureDir(path.join(dataRoot(), 'crash-dumps'));
}

/**
 * M8b.6: folders a source must never contain or sit inside: the app's own
 * code and its data root (dev: the project folder, which holds .dev-data;
 * packaged: Photos.app and PhotosData beside it). Both the given and the
 * real (symlink-resolved) forms are returned, de-duplicated. Main process
 * only; workers receive the list in workerData.
 */
function protectedRoots() {
  const roots = app.isPackaged
    ? [path.dirname(path.dirname(path.dirname(app.getPath('exe')))), getDataRoot()]
    : [app.getAppPath(), getDataRoot()];
  const out = new Set();
  for (const r of roots) {
    out.add(path.resolve(r));
    try { out.add(fs.realpathSync(r)); } catch (err) { /* not created yet */ }
  }
  return Array.from(out);
}

/** Convenience bundle for IPC responses / logging. */
function allPaths() {
  return {
    dataRoot: dataRoot(),
    dbPath: dbPath(),
    thumbnailsDir: thumbnailsDir(),
    displayCacheDir: displayCacheDir(),
    configPath: configPath(),
    logsDir: logsDir(),
    faceCropsDir: faceCropsDir(),
  };
}

module.exports = {
  dataRoot,
  dbPath,
  thumbnailsDir,
  displayCacheDir,
  configPath,
  logsDir,
  electronDataDir,
  tempDir,
  crashDumpsDir,
  faceCropsDir,
  allPaths,
  protectedRoots,
  // exported for tests / diagnostics only, not for general use:
  _getAppBundleParentDir: getAppBundleParentDir,
};
