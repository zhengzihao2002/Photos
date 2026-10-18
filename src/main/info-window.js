/**
 * info-window.js (M8c.2b)
 *
 * The Info window: a small floating window beside the main window, as in
 * Apple Photos (Window > Info / Cmd+I). It shows the item open in the viewer,
 * otherwise the item selected in the grid.
 *
 * - Floating: above the app's windows, also while the main window is minimised
 *   or full screen; hidden while another app is active (like Mac panels);
 *   closes when the main window closes. Cmd+W closes it first (menu.js).
 * - Non-focusable: keyboard and menu commands stay with the main window
 *   (menu items target the focused window), while clicks still work.
 * - Open/closed is kept for the session only (starts closed at launch).
 * - Position is remembered in config.json (viewer.infoX / viewer.infoY).
 * - All events to windows go through window-bus; a newly loaded Info page
 *   asks for the current item itself (info:get-state).
 */

const path = require('path');
const { app, BrowserWindow, screen } = require('electron');
const config = require('./config');
const bus = require('./window-bus');
const { t } = require('./i18n'); // M14

const WIDTH = 290;
const MIN_H = 120;
const MAX_H = 800;

let parentWin = null;
let infoWin = null;
let currentItemId = null;
let currentSelection = null; // M12.6: '::sel:' filter while 2+ items are selected
let saveTimer = null;

function isOpen() {
  return !!infoWin && !infoWin.isDestroyed();
}

function broadcastVisibility() {
  bus.send('info:visibility', { open: isOpen() });
}

function onScreen(x, y) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return x >= a.x - WIDTH + 40 && x <= a.x + a.width - 40 && y >= a.y && y <= a.y + a.height - 40;
  });
}

function initialPosition() {
  const v = config.load().viewer || {};
  if (Number.isFinite(v.infoX) && Number.isFinite(v.infoY) && onScreen(v.infoX, v.infoY)) {
    return { x: v.infoX, y: v.infoY };
  }
  const b = parentWin.getBounds();
  return { x: b.x + b.width - WIDTH - 24, y: b.y + 80 }; // inside the main window's right edge
}

function savePositionSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!isOpen()) return;
    const [x, y] = infoWin.getPosition();
    config.update({ viewer: { infoX: x, infoY: y } });
  }, 400);
}

function open() {
  if (isOpen() || !parentWin || parentWin.isDestroyed()) return;
  const { x, y } = initialPosition();
  infoWin = new BrowserWindow({
    x, y, width: WIDTH, height: 300,
    useContentSize: true,
    title: t('window.info'),
    show: false,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    vibrancy: 'popover',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  infoWin.setAlwaysOnTop(true, 'floating');
  infoWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // over a full-screen main window
  infoWin.once('ready-to-show', () => { if (isOpen() && app.isActive !== false) infoWin.showInactive(); });
  infoWin.on('move', savePositionSoon);
  infoWin.on('closed', () => {
    clearTimeout(saveTimer);
    infoWin = null;
    broadcastVisibility();
  });
  infoWin.loadFile(path.join(__dirname, '..', 'renderer', 'info.html'));
  broadcastVisibility();
}

function close() {
  if (isOpen()) infoWin.close(); // 'closed' broadcasts the new state
}

function toggle() {
  if (isOpen()) close(); else open();
}

// Like a Mac panel: hidden while another app is active, back when Photos is.
let appHooks = false;
function hookAppActivation() {
  if (appHooks) return;
  appHooks = true;
  app.on('did-resign-active', () => { if (isOpen()) infoWin.hide(); });
  app.on('did-become-active', () => { if (isOpen() && !infoWin.isVisible()) infoWin.showInactive(); });
}

function attach(mainWindow) {
  hookAppActivation();
  parentWin = mainWindow;
  mainWindow.on('closed', () => {
    parentWin = null;
    close(); // a child window closes with its parent; this also resets the state
  });
}

function setItem(id) {
  currentItemId = Number.isInteger(id) ? id : null;
  bus.send('info:item', { id: currentItemId });
}

function setSelection(filter) {
  currentSelection = typeof filter === 'string' && filter.length > 0 && filter.length < 2100000 ? filter : null;
  bus.send('info:selection', { filter: currentSelection });
}

function getSelection() {
  return currentSelection;
}

function getItem() {
  return currentItemId;
}

// M12.4: typing needs keyboard focus. The window is non-focusable except while a field is being edited.
function setEditing(editing) {
  if (!isOpen()) return;
  if (editing) {
    infoWin.setFocusable(true);
    infoWin.focus();
  } else {
    infoWin.setFocusable(false);
    if (parentWin && !parentWin.isDestroyed()) parentWin.focus();
  }
}

function setHeight(h) {
  if (!isOpen() || !Number.isFinite(h)) return;
  const height = Math.round(Math.min(MAX_H, Math.max(MIN_H, h)));
  infoWin.setContentSize(WIDTH, height);
}

/** M14: new title after a language change (the page itself reloads). */
function retitle() {
  if (isOpen()) infoWin.setTitle(t('window.info'));
}

module.exports = { retitle, attach, open, close, toggle, isOpen, setItem, getItem, setSelection, getSelection, setHeight, setEditing };
