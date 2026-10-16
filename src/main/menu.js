/**
 * menu.js
 *
 * Standard macOS app menu: App, Edit, View, Window. Deliberately no "File"
 * menu yet — every File-menu action worth having right now (add folder,
 * import, etc.) implies scanning/writing to the index, which is out of
 * scope for M0. Later modules should add a File menu rather than repurpose
 * these.
 *
 * M5: a macOS File menu now exists containing ONLY "Close Window" (Cmd+W),
 * which is where Apple places it. Still no scanning/writing actions here.
 *
 * M6: View > Hide Sidebar / Show Sidebar (Alt+Cmd+S, as in Apple Photos).
 * The label reflects the current state, so the renderer reports changes via
 * menu:set-sidebar-visible and main rebuilds the menu (labels of a built
 * macOS menu cannot change in place). The click sends menu:toggle-sidebar to
 * the window the menu acted on.
 *
 * M6: File > Add Folder... (Shift+Cmd+I, Apple Photos' Import shortcut)
 * sends menu:add-folder; the renderer opens the picker and adds the folders.
 */

const { app, Menu } = require('electron');

// M10.8: the menu is rebuilt whole on every change, so remember each state value and
// let callers pass only what changed (a sidebar rebuild must not reset People).
const menuState = { sidebarVisible: true, peopleEnabled: true };

function buildMenu(opts = {}) {
  if (typeof opts.sidebarVisible === 'boolean') menuState.sidebarVisible = opts.sidebarVisible;
  if (typeof opts.peopleEnabled === 'boolean') menuState.peopleEnabled = opts.peopleEnabled;
  const { sidebarVisible, peopleEnabled } = menuState;
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              // M8c.6: Photos > Settings... (Cmd+,), as in Apple Photos.
              { label: 'Settings\u2026', accelerator: 'Command+,', click: () => require('./settings-window').open() },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    ...(isMac
      ? [{
          label: 'File',
          submenu: [
            // M6: Apple Photos' Import shortcut; this app's equivalent action.
            // Registers a folder path only -- never copies or moves files.
            {
              label: 'Add Folder\u2026',
              accelerator: 'Shift+Command+I',
              click: (menuItem, browserWindow) => {
                if (browserWindow) browserWindow.webContents.send('menu:add-folder');
              },
            },
            // M6: queue a rescan of every found source folder (renderer).
            {
              label: 'Rescan All Folders',
              click: (menuItem, browserWindow) => {
                if (browserWindow) browserWindow.webContents.send('menu:rescan-all');
              },
            },
            { type: 'separator' },
            // M8c.2b: Cmd+W closes the Info window first when it is open (it never
            // takes focus), otherwise the main window.
            {
              label: 'Close', accelerator: 'Command+W',
              click: (menuItem, browserWindow) => {
                const info = require('./info-window');
                if (info.isOpen()) info.close(); else if (browserWindow) browserWindow.close();
              },
            },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar',
          accelerator: 'Alt+Command+S',
          click: (menuItem, browserWindow) => {
            if (browserWindow) browserWindow.webContents.send('menu:toggle-sidebar');
          },
        },
        { type: 'separator' },
        // M10.8: People face analysis on/off, and erase every piece of face data.
        {
          label: 'People', type: 'checkbox', checked: peopleEnabled,
          click: (menuItem, browserWindow) => { require('./people/people-privacy').setEnabled(menuItem.checked, browserWindow); },
        },
        {
          label: 'Delete All People Data\u2026',
          click: (menuItem, browserWindow) => { require('./people/people-privacy').deleteAll(browserWindow); },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        // M8c.2b: Window > Info (Cmd+I), as in Apple Photos. Handled here so it
        // works in every section and whichever window has focus.
        { type: 'separator' },
        { label: 'Info', accelerator: 'Command+I', click: () => require('./info-window').toggle() },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
