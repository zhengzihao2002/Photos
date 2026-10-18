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
const i18n = require('./i18n'); // M14: every label comes from the catalog, never from Electron's OS-language role labels

// M10.8: the menu is rebuilt whole on every change, so remember each state value and
// let callers pass only what changed (a sidebar rebuild must not reset People).
const menuState = { sidebarVisible: true, peopleEnabled: true };

function buildMenu(opts = {}) {
  if (typeof opts.sidebarVisible === 'boolean') menuState.sidebarVisible = opts.sidebarVisible;
  if (typeof opts.peopleEnabled === 'boolean') menuState.peopleEnabled = opts.peopleEnabled;
  const { sidebarVisible, peopleEnabled } = menuState;
  const isMac = process.platform === 'darwin';
  const t = i18n.t;

  const template = [
    ...(isMac
      ? [
          {
            label: t('app.name'),
            submenu: [
              { label: t('menu.about'), click: () => app.showAboutPanel() },
              { type: 'separator' },
              // M8c.6: Photos > Settings... (Cmd+,), as in Apple Photos.
              { label: t('menu.settings'), accelerator: 'Command+,', click: () => require('./settings-window').open() },
              { type: 'separator' },
              { role: 'services', label: t('menu.services') },
              { type: 'separator' },
              { role: 'hide', label: t('menu.hide') },
              { role: 'hideOthers', label: t('menu.hideOthers') },
              { role: 'unhide', label: t('menu.showAll') },
              { type: 'separator' },
              { role: 'quit', label: t('menu.quit') },
            ],
          },
        ]
      : []),
    ...(isMac
      ? [{
          label: t('menu.file'),
          submenu: [
            // M6: Apple Photos' Import shortcut; this app's equivalent action.
            // Registers a folder path only -- never copies or moves files.
            {
              label: t('menu.file.addFolder'),
              accelerator: 'Shift+Command+I',
              click: (menuItem, browserWindow) => {
                if (browserWindow) browserWindow.webContents.send('menu:add-folder');
              },
            },
            // M6: queue a rescan of every found source folder (renderer).
            {
              label: t('menu.file.rescanAll'),
              click: (menuItem, browserWindow) => {
                if (browserWindow) browserWindow.webContents.send('menu:rescan-all');
              },
            },
            { type: 'separator' },
            // M8c.2b: Cmd+W closes the Info window first when it is open (it never
            // takes focus), otherwise the main window.
            {
              label: t('menu.file.close'), accelerator: 'Command+W',
              click: (menuItem, browserWindow) => {
                const info = require('./info-window');
                if (info.isOpen()) info.close(); else if (browserWindow) browserWindow.close();
              },
            },
          ],
        }]
      : []),
    {
      label: t('menu.edit'),
      submenu: [
        {
          // M12.9: Undo / Redo of favorite, title, caption and keyword edits. The main
          // window's page decides (a focused text field keeps its own text undo);
          // other windows and DevTools keep the native action.
          label: t('menu.edit.undo'),
          accelerator: 'CmdOrCtrl+Z',
          click: (menuItem, browserWindow) => {
            if (!browserWindow) return;
            const wc = browserWindow.webContents;
            if (wc.isDevToolsFocused() && wc.devToolsWebContents) { wc.devToolsWebContents.undo(); return; }
            if (/\/index\.html(?:[?#]|$)/.test(wc.getURL())) wc.send('menu:undo'); else wc.undo();
          },
        },
        {
          label: t('menu.edit.redo'),
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: (menuItem, browserWindow) => {
            if (!browserWindow) return;
            const wc = browserWindow.webContents;
            if (wc.isDevToolsFocused() && wc.devToolsWebContents) { wc.devToolsWebContents.redo(); return; }
            if (/\/index\.html(?:[?#]|$)/.test(wc.getURL())) wc.send('menu:redo'); else wc.redo();
          },
        },
        { type: 'separator' },
        { role: 'cut', label: t('menu.edit.cut') },
        { role: 'copy', label: t('menu.edit.copy') },
        { role: 'paste', label: t('menu.edit.paste') },
        {
          // M12.2: custom item so Cmd+A can select every photo in the main
          // window's grid. The main window's page decides (a text field gets
          // ordinary text Select All); DevTools and other windows keep the
          // standard action.
          label: t('menu.edit.selectAll'),
          accelerator: 'CmdOrCtrl+A',
          click: (menuItem, browserWindow) => {
            if (!browserWindow) return;
            const wc = browserWindow.webContents;
            if (wc.isDevToolsFocused() && wc.devToolsWebContents) { wc.devToolsWebContents.selectAll(); return; }
            if (/\/index\.html(?:[?#]|$)/.test(wc.getURL())) wc.send('menu:select-all');
            else wc.selectAll();
          },
        },
      ],
    },
    {
      // M12.3: Image > Favorite. No accelerator: a bare '.' would fire inside text
      // fields; the page handles the '.' key itself and this item sends the same action.
      label: t('menu.image'),
      submenu: [
        { label: t('menu.image.rotateCcw'), accelerator: 'CmdOrCtrl+R', click: (mi, bw) => { if (bw && /\/index\.html(?:[?#]|$)/.test(bw.webContents.getURL())) bw.webContents.send('menu:rotate', -90); } }, // M12.11
        { label: t('menu.image.rotateCw'), accelerator: 'Alt+CmdOrCtrl+R', click: (mi, bw) => { if (bw && /\/index\.html(?:[?#]|$)/.test(bw.webContents.getURL())) bw.webContents.send('menu:rotate', 90); } },
        { type: 'separator' },
        {
          label: t('menu.image.favorite'),
          click: (menuItem, browserWindow) => {
            if (browserWindow && /\/index\.html(?:[?#]|$)/.test(browserWindow.webContents.getURL())) browserWindow.webContents.send('menu:favorite');
          },
        },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: sidebarVisible ? t('menu.view.hideSidebar') : t('menu.view.showSidebar'),
          accelerator: 'Alt+Command+S',
          click: (menuItem, browserWindow) => {
            if (browserWindow) browserWindow.webContents.send('menu:toggle-sidebar');
          },
        },
        { type: 'separator' },
        // M10.8: People face analysis on/off, and erase every piece of face data.
        {
          label: t('menu.view.people'), type: 'checkbox', checked: peopleEnabled,
          click: (menuItem, browserWindow) => { require('./people/people-privacy').setEnabled(menuItem.checked, browserWindow); },
        },
        {
          label: t('menu.view.deletePeople'),
          click: (menuItem, browserWindow) => { require('./people/people-privacy').deleteAll(browserWindow); },
        },
        { type: 'separator' },
        { role: 'reload', label: t('menu.view.reload') },
        { role: 'toggleDevTools', label: t('menu.view.devTools') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.view.fullScreen') },
        { type: 'separator' },
        {
          // M14: the language is chosen here, in the menu bar, and takes effect at once in every window.
          label: t('menu.view.language'),
          submenu: [
            { label: t('lang.en'), type: 'radio', checked: i18n.getLocale() !== 'zh-Hans', click: () => i18n.setLanguage('en') },
            { label: t('lang.zh'), type: 'radio', checked: i18n.getLocale() === 'zh-Hans', click: () => i18n.setLanguage('zh-Hans') },
          ],
        },
      ],
    },
    {
      label: t('menu.window'),
      submenu: [
        { role: 'minimize', label: t('menu.window.minimize') },
        { role: 'zoom', label: t('menu.window.zoom') },
        // M8c.2b: Window > Info (Cmd+I), as in Apple Photos. Handled here so it
        // works in every section and whichever window has focus.
        { type: 'separator' },
        { label: t('menu.window.info'), accelerator: 'Command+I', click: () => require('./info-window').toggle() },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: t('menu.window.front') }] : [{ role: 'close', label: t('menu.window.close') }]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

/** About panel: name and credits in the active language (called at launch and on a language change). */
function applyAboutPanel() {
  app.setAboutPanelOptions({ applicationName: i18n.t('app.name'), applicationVersion: app.getVersion() });
}

module.exports = { buildMenu, applyAboutPanel };
