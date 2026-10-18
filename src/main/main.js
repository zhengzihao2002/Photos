/**
 * main.js
 *
 * Entry point. Creates the single BrowserWindow with Apple-Photos-style
 * chrome, wires up the app menu and IPC, and persists window size/position.
 *
 * Renderer never touches Node or Electron directly (contextIsolation: true,
 * nodeIntegration: false, no remote module) — see preload.js for the only
 * surface the renderer gets.
 */

// M10 (People): onnxruntime 1.29+ ships Microsoft telemetry on macOS that writes
// to ~/Library and can upload usage events. It reads this variable when it loads,
// so it is set first, for this process and every worker thread it starts.
process.env.ORT_DISABLE_TELEMETRY = '1';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, Menu } = require('electron');

require('./security').install(); // M11: navigation, window.open, permissions
const paths = require('./paths');
// M11: refuse any write to a source folder, or outside the data/temp folders (see write-guard.js).
try {
  require('./write-guard').install({ allowedRoots: [paths.dataRoot(), paths.tempDir(), require('os').tmpdir()] });
} catch (err) {
  console.error('write guard not installed:', err.message); // the data-folder check below reports the real problem
}
const config = require('./config');
const { buildMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc');
const db = require('./index/db');
const thumbnailManager = require('./thumbnails/thumbnail-manager');
const faceManager = require('./faces/face-manager'); // M10: People
const mediaProtocol = require('./display/media-protocol');
const displayService = require('./display/display-service');
const residueCleanup = require('./residue-cleanup');
const i18n = require('./i18n'); // M14
const { t } = i18n;

// M7 + M8a (self-containment): keep everything Electron writes -- network
// cache (map tiles), GPU/code caches, cookies, logs, crash dumps, temp files
// -- inside the app's data folder instead of ~/Library and the system temp
// folder, so deleting the app folder leaves nothing behind. Must run before
// app 'ready'. If the data folder cannot be created (e.g. a read-only disk
// image), Electron keeps its defaults and the existing startup check reports
// the problem.
try {
  app.setPath('userData', paths.electronDataDir());
  app.setPath('sessionData', paths.electronDataDir());
  app.setPath('crashDumps', paths.crashDumpsDir());
  app.setAppLogsPath(paths.logsDir());

  // The temp folder is disposable: empty it at launch, then hand it to
  // Electron and, through the environment, to worker threads and child
  // processes (sips, ffmpeg, ffprobe).
  const tempDir = paths.tempDir();
  for (const name of fs.readdirSync(tempDir)) {
    fs.rmSync(path.join(tempDir, name), { recursive: true, force: true });
  }
  app.setPath('temp', tempDir);
  process.env.TMPDIR = tempDir;
} catch (err) {
  console.error('Could not redirect Electron storage:', err.message);
}

// M8a: the app has no logins and its cookies are disposable, so Chromium
// must never create a "Safe Storage" item in the user's Keychain.
app.commandLine.appendSwitch('use-mock-keychain');

// M5: privileged custom schemes must be declared before app 'ready'.
mediaProtocol.registerScheme();

let mainWindow = null;

// Resize/move events fire rapidly; debounce writes to disk so dragging a
// window doesn't hammer the filesystem.
let saveWindowStateTimer = null;
function scheduleSaveWindowState() {
  if (!mainWindow) return;
  clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(saveWindowStateNow, 400);
}

function saveWindowStateNow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  config.update({
    window: {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    },
  });
}

function createMainWindow() {
  const savedConfig = config.load();
  const { width, height, x, y } = savedConfig.window;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: x === null ? undefined : x,
    y: y === null ? undefined : y,
    minWidth: 860,
    minHeight: 560,
    show: false, // reveal after first paint to avoid a white flash
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 18 }, // approximates Photos.app's inset
    vibrancy: 'sidebar', // native NSVisualEffectView material
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('close', saveWindowStateNow);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  // M8c.2b: the Info window is a child of the current main window.
  require('./info-window').attach(mainWindow);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

/**
 * Confirms the data folder is actually writable before the rest of the app
 * relies on it. The main failure mode this guards against: the user
 * double-clicked Photos.app straight out of a mounted, read-only .dmg
 * instead of copying it to a normal folder first (see paths.js for why the
 * data folder lives next to the .app bundle).
 */
function verifyDataFolderWritable() {
  try {
    paths.dataRoot(); // creates the folder as a side effect if missing
    return true;
  } catch (err) {
    dialog.showErrorBox(t('dialog.dataFolder.title'), t('dialog.dataFolder.body', { details: err.message }));
    return false;
  }
}

/**
 * Opens the SQLite index (creating the file and running migrations on first
 * launch) before anything else in the app relies on it.
 */
function initializeDatabase() {
  try {
    db.get();
    return true;
  } catch (err) {
    dialog.showErrorBox(t('dialog.db.title'), t('dialog.db.body', { details: err.message }));
    return false;
  }
}

app.whenReady().then(() => {
  if (!verifyDataFolderWritable()) {
    app.quit();
    return;
  }

  if (!initializeDatabase()) {
    app.quit();
    return;
  }
  require('./index/source-guard').sync(); // M11

  Menu.setApplicationMenu(buildMenu());
  // M6 (B.9): app identity. In development the Dock icon is set here (the
  // packaged app gets its name and icon from its own bundle, icon.icns).
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    const devIcon = require('path').join(__dirname, '..', '..', 'build', 'icon.png');
    if (require('fs').existsSync(devIcon)) app.dock.setIcon(devIcon);
  }
  require('./menu').applyAboutPanel(); // M14: name follows the app language
  registerIpcHandlers();
  mediaProtocol.handle();   // M5: photos-media:// (ids only, Range-capable)
  displayService.init();    // M5: empties display-cache/.tmp, indexes cache (async)
  createMainWindow();
  thumbnailManager.start({ mainWindow });
  require('./people/people-privacy').init(mainWindow); // M10.8: menu state; face worker only if People is on
  // M8b.5: catch up on changes made while closed, then watch every source.
  // After each scan the watcher set is re-synced (a scan may mark a source
  // missing; add/relink/remove also call refresh).
  const folderWatcher = require('./index/folder-watcher');
  folderWatcher.reconcileAtLaunch();
  folderWatcher.refresh();
  require('./index/scan-queue').onScanFinished(() => folderWatcher.refresh());
  require('./index/source-monitor').start(); // M8b.7: automatic missing / found again

  app.on('activate', () => {
    if (!mainWindow) createMainWindow(); // M8c.2b: the Info window is a second window
  });
});

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  // M8b.2: the scan queue stops too (pending dropped, running worker ended)
  // before the database closes; the next launch catches up.
  const scanQueue = require('./index/scan-queue');
  require('./index/folder-watcher').stopAll(); // M8b.5
  require('./index/source-monitor').stop(); // M8b.7
  Promise.all([thumbnailManager.stop(), faceManager.stop(), scanQueue.shutdown()]).then(() => {
    db.close();
    residueCleanup.schedule(); // M8a: remove per-app items macOS wrote outside the data folder
    app.exit(0);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Ctrl+C in the terminal (SIGINT) and a process kill request (SIGTERM) both
// terminate Node immediately by default, skipping 'before-quit' entirely and
// leaving WAL un-checkpointed. Redirecting them into app.quit() ensures the
// same clean shutdown path runs no matter how the app is asked to stop.
process.on('SIGINT', () => {
  app.quit();
});

process.on('SIGTERM', () => {
  app.quit();
});
