/**
 * settings-window.js (M8c.6) -- Photos > Settings... (Cmd+,), as in Apple
 * Photos. One window: opening it again brings it forward. Fixed size, normal
 * focusable window, independent of the main window. Page: settings.html.
 */
const path = require('path');
const { BrowserWindow } = require('electron');
const { t } = require('./i18n'); // M14

let win = null;

function open() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 620,
    height: 480,
    useContentSize: true,
    title: t('window.settings'),
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    vibrancy: 'window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => { if (win && !win.isDestroyed()) win.show(); });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
}

/** M14: new title after a language change (the page itself reloads). */
function retitle() {
  if (win && !win.isDestroyed()) win.setTitle(t('window.settings'));
}

module.exports = { open, retitle };
