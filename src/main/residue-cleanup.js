/**
 * residue-cleanup.js (M8a, self-containment)
 *
 * macOS writes a few small items for every app, filed under the app's bundle
 * identifier, that the app cannot redirect into its data folder:
 *   - a preferences entry (dialog sizes, last folder shown in the picker)
 *   - graphics shader caches in the per-user cache area (/var/folders/.../C/)
 *   - occasionally saved window state, a URL cache, HTTP storage, WebKit data
 *
 * They cannot be prevented, so they are removed after each quit: a detached
 * shell command waits for the app to finish exiting, then deletes them. Only
 * macOS built-in tools are used. Failure is silent and never delays quitting.
 *
 * The identifier is read from the bundle the app is running in, so this gives
 * com.github.Electron in development and com.local.photos when packaged.
 */

const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { app } = require('electron');

const SCRIPT = `
sleep 3
ID="$1"
/usr/bin/defaults delete "$ID" >/dev/null 2>&1
C="$(/usr/bin/getconf DARWIN_USER_CACHE_DIR 2>/dev/null)"
if [ -n "$C" ]; then rm -rf "$C$ID" "$C$ID".helper*; fi
L="$HOME/Library"
rm -rf "$L/Preferences/$ID.plist" "$L/Saved Application State/$ID.savedState" \\
  "$L/Caches/$ID" "$L/HTTPStorages/$ID" "$L/HTTPStorages/$ID.binarycookies" "$L/WebKit/$ID"
`;

/** Bundle identifier of the running app, or null if it cannot be read safely. */
function bundleId() {
  // .../X.app/Contents/MacOS/X  ->  .../X.app/Contents/Info.plist
  const info = path.join(path.dirname(path.dirname(app.getPath('exe'))), 'Info.plist');
  const out = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', info], {
    encoding: 'utf8',
    timeout: 2000,
  }).trim();
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(out) ? out : null;
}

/** Call once, just before the app exits. */
function schedule() {
  if (process.platform !== 'darwin') return;
  try {
    const id = bundleId();
    if (!id) return;
    const child = spawn('/bin/sh', ['-c', SCRIPT, 'photos-residue-cleanup', id], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    // Cleanup is best-effort; quitting must never fail because of it.
  }
}

module.exports = { schedule };
