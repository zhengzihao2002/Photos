/**
 * resource-paths.js  (M7.3)
 *
 * The single source of truth for where STATIC, read-only app resources live
 * (datasets and other files shipped with the app). The counterpart of
 * paths.js, which covers everything the app WRITES. No other file should
 * build one of these paths itself.
 *
 *   Development (./dev start): <project root>/resources/...
 *   Packaged app:             Photos.app/Contents/Resources/...
 *
 * For M9 (packaging): each subfolder used here must be listed in
 * package.json build.mac.extraResources with the same name, e.g.
 *   { "from": "resources/geo", "to": "geo" }
 * These files are deliberately kept OUTSIDE app.asar: they are read with
 * plain fs from a worker thread, and large files do not belong in the
 * archive.
 *
 * Main process only: this needs Electron's `app`. Worker threads must be
 * handed the resolved path (see scan-manager.js workerData).
 */

const path = require('path');
const { app } = require('electron');

function resourcesRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  // Dev mode: app.getAppPath() is the project root (folder containing package.json).
  return path.join(app.getAppPath(), 'resources');
}

/** Offline reverse-geocoding dataset (built by tools/build-geo-dataset.js). */
function geoDatasetPath() {
  return path.join(resourcesRoot(), 'geo', 'places.json');
}

/** M10: face detection and embedding models (see resources/models/VERSION.txt).
 * M9: needs an extraResources entry { from: 'resources/models', to: 'models' }. */
function modelsDir() {
  return path.join(resourcesRoot(), 'models');
}

module.exports = { resourcesRoot, geoDatasetPath, modelsDir };
