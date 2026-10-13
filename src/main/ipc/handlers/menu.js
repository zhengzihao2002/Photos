/**
 * IPC channel for keeping the app menu in sync with renderer state (M6).
 *
 * menu:set-sidebar-visible
 *   Request:  { visible: boolean }
 *   Response: { ok: true }
 *   Effect:   rebuilds the application menu so View shows "Hide Sidebar"
 *             when visible, "Show Sidebar" when hidden. Built macOS menu
 *             labels cannot change in place, hence the rebuild. Menu only:
 *             no other side effects.
 *
 * menu:show-album-context-menu   (M6, B.5 Albums)
 *   Request:  { sourceFolderId: number }
 *   Response: { action: 'rescan' | 'rescan-all' | 'relink' | 'remove' | null,
 *               newRootPath?: string }   (newRootPath only for 'relink')
 *   Native right-click menu for an album (source folder): Rescan, Show in
 *   Finder, Relink..., Remove from Library... The folder's path is looked up
 *   here from the database -- the renderer sends only the id, so Show in
 *   Finder can only open a registered source folder. Show in Finder and the
 *   Relink picker are handled here; the renderer performs the returned
 *   action through its shared folder actions. Never touches photo files.
 *
 * menu:show-photo-context-menu   (M6 B.6g)
 *   Request:  { itemId: number }
 *   Response: { action: 'info' | 'rescan-all' | null }
 *   Native right-click menu for a photo/video: Get Info, Show in Finder,
 *   Rescan All Folders, then Favorite / Rotate / Edit / Hide / Duplicate /
 *   Delete shown DISABLED (read-only library). The file path is looked up
 *   here from the id; Show in Finder reveals it (shell.showItemInFolder,
 *   read-only) and returns action null.
 *
 * menu:show-person-context-menu   (M10.7, People page)
 *   Request:  { count: number, named: boolean, hidden: boolean }  (count = people selected)
 *   Response: { action: 'name' | 'merge' | 'hide' | 'unhide' | null }
 *   Apple's menu for a person card. Name / Merge / Hide work (database only, done
 *   by the renderer through people:* channels); the rest is shown DISABLED.
 *
 * menu:show-person-page-menu   (M10.7, the person page's ... button)
 *   Request:  { named: boolean, hidden: boolean, view: 'photos' | 'faces', x: number, y: number }
 *   Response: { action: 'review' | 'name' | 'hide' | 'unhide' | 'show-photos' | 'show-faces' | null }
 *
 * menu:show-people-sort-menu   (M10.7, the People page's Sort button)
 *   Request:  { current: 'name' | 'custom', x: number, y: number }
 *   Response: { choice: 'name' | 'custom' | null }
 *
 * menu:show-view-filter-menu   (M6, album / All Photos view menu)
 *   Request:  { current: 'all' | 'photos' | 'videos', x: number, y: number }
 *             (x, y = window coordinates in points, under the toolbar button)
 *   Response: { choice: 'all' | 'photos' | 'videos' | null }  (null = dismissed)
 *   All Items / Photos / Videos with a checkmark on the current choice;
 *   Favorites and Edited shown DISABLED (write features).
 */

const { Menu, BrowserWindow, dialog, shell } = require('electron');
const { buildMenu } = require('../../menu');
const db = require('../../index/db');
const { listSourceFolders } = require('../../index/source-folders');
const queries = require('../../index/queries');
const fs = require('fs');

async function setSidebarVisible(event, payload = {}) {
  Menu.setApplicationMenu(buildMenu({ sidebarVisible: payload.visible !== false }));
  return { ok: true };
}

// Hold the open menu so it cannot be garbage-collected while on screen
// (popup() returns immediately; a collected menu closes itself).
let activeAlbumMenu = null;

async function showAlbumContextMenu(event, payload = {}) {
  const id = Number(payload.sourceFolderId);
  const sources = await listSourceFolders(db.get());
  const source = (sources || []).find((s) => s.id === id);
  if (!source) return { action: null };
  const win = BrowserWindow.fromWebContents(event.sender);
  const found = source.status === 'ok';

  const chosen = await new Promise((resolve) => {
    let settled = false;
    const pick = (action) => { if (!settled) { settled = true; resolve(action); } };
    const menu = Menu.buildFromTemplate([
      { label: 'Rescan', enabled: found, click: () => pick('rescan') },
      { label: 'Rescan All Folders', click: () => pick('rescan-all') },
      { label: 'Show in Finder', enabled: found, click: () => pick('show') },
      { label: 'Relink\u2026', click: () => pick('relink') },
      { type: 'separator' },
      { label: 'Remove from Library\u2026', click: () => pick('remove') },
    ]);
    activeAlbumMenu = menu;
    // 'closed' can fire around the same time as a click; wait briefly so a
    // real click always wins over a dismissal.
    menu.popup({
      window: win,
      callback: () => setTimeout(() => {
        if (activeAlbumMenu === menu) activeAlbumMenu = null;
        pick(null);
      }, 150),
    });
  });

  if (chosen === 'show') {
    await shell.openPath(source.rootPath);
    return { action: null };
  }
  if (chosen === 'relink') {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Locate \u201C' + source.displayName + '\u201D',
      message: 'Choose the folder\u2019s new location. Photos are not moved or copied.',
    });
    if (res.canceled || !res.filePaths.length) return { action: null };
    return { action: 'relink', newRootPath: res.filePaths[0] };
  }
  return { action: chosen };
}

let activePhotoMenu = null; // held so it can't be garbage-collected while open

async function showPhotoContextMenu(event, payload = {}) {
  const item = queries.getItemById(db.get(), Number(payload.itemId));
  if (!item) return { action: null };
  const win = BrowserWindow.fromWebContents(event.sender);
  const filePath = item.absolute_path;
  // M10.7: on a person's page, corrections for this photo's face of that person.
  const personId = Number.isSafeInteger(payload.personId) && payload.personId > 0 ? payload.personId : null;
  let personItems = [];
  let clusterId = null;
  if (personId != null) {
    const conn = db.get();
    const person = conn.prepare('SELECT name FROM people WHERE id = ?').get(personId);
    const face = conn.prepare('SELECT cluster_id FROM faces WHERE item_id = ? AND person_id = ? ORDER BY box_w * box_h DESC LIMIT 1').get(item.id, personId);
    if (person && face) {
      const groups = conn.prepare('SELECT COUNT(*) AS n FROM face_clusters WHERE person_id = ?').get(personId).n;
      const size = face.cluster_id == null ? 0 : conn.prepare('SELECT COUNT(*) AS n FROM faces WHERE cluster_id = ?').get(face.cluster_id).n;
      clusterId = face.cluster_id;
      personItems = [
        { label: 'Make Key Photo', action: 'key-photo' },
        { label: person.name ? 'Not ' + person.name : 'Not This Person', action: 'not-person' },
      ];
      if (groups > 1 && clusterId != null) personItems.push({ label: 'Remove This Group (' + size + (size === 1 ? ' Face)' : ' Faces)'), action: 'remove-group' });
    }
  }
  let exists = false;
  try { exists = fs.existsSync(filePath); } catch (err) { exists = false; }

  const chosen = await new Promise((resolve) => {
    let settled = false;
    const pick = (action) => { if (!settled) { settled = true; resolve(action); } };
    const disabled = (label) => ({ label, enabled: false });
    const menu = Menu.buildFromTemplate([
      ...personItems.map((p) => ({ label: p.label, click: () => pick(p.action) })),
      ...(personItems.length ? [{ type: 'separator' }] : []),
      { label: 'Get Info', click: () => pick('info') },
      { label: 'Show in Finder', enabled: exists, click: () => pick('show') },
      { type: 'separator' },
      { label: 'Rescan All Folders', click: () => pick('rescan-all') },
      { type: 'separator' },
      disabled('Favorite'),
      disabled('Rotate'),
      disabled('Edit'),
      disabled('Hide'),
      disabled('Duplicate'),
      disabled('Delete'),
    ]);
    activePhotoMenu = menu;
    menu.popup({
      window: win,
      callback: () => setTimeout(() => {
        if (activePhotoMenu === menu) activePhotoMenu = null;
        pick(null);
      }, 150),
    });
  });

  if (chosen === 'show') {
    shell.showItemInFolder(filePath);
    return { action: null };
  }
  return { action: chosen, clusterId: chosen === 'remove-group' ? clusterId : null };
}

let activeViewMenu = null; // held so it can't be garbage-collected while open

async function showViewFilterMenu(event, payload = {}) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const current = ['all', 'photos', 'videos'].includes(payload.current) ? payload.current : 'all';
  const x = Math.max(0, Math.round(Number(payload.x) || 0));
  const y = Math.max(0, Math.round(Number(payload.y) || 0));

  const choice = await new Promise((resolve) => {
    let settled = false;
    const pick = (value) => { if (!settled) { settled = true; resolve(value); } };
    const option = (label, value) => ({ label, type: 'checkbox', checked: current === value, click: () => pick(value) });
    const menu = Menu.buildFromTemplate([
      option('All Items', 'all'),
      { type: 'separator' },
      { label: 'Favorites', enabled: false },
      { label: 'Edited', enabled: false },
      option('Photos', 'photos'),
      option('Videos', 'videos'),
    ]);
    activeViewMenu = menu;
    menu.popup({
      window: win,
      x,
      y,
      callback: () => setTimeout(() => {
        if (activeViewMenu === menu) activeViewMenu = null;
        pick(null);
      }, 150),
    });
  });
  return { choice };
}

let activePersonMenu = null; // held so it can't be garbage-collected while open

async function showPersonContextMenu(event, payload = {}) {
  const count = Math.max(1, Math.min(9999, Math.floor(Number(payload.count) || 1)));
  const named = payload.named === true;
  const hidden = payload.hidden === true;
  const win = BrowserWindow.fromWebContents(event.sender);
  const people = count === 1 ? '1 Person' : count + ' People';
  const chosen = await new Promise((resolve) => {
    let settled = false;
    const pick = (action) => { if (settled === false) { settled = true; resolve(action); } };
    const menu = Menu.buildFromTemplate([
      { label: 'Show Info', enabled: false },
      { label: 'Pin', enabled: false },
      { type: 'separator' },
      { label: 'Play Slideshow', enabled: false },
      { type: 'separator' },
      { label: 'Add to Favorites', enabled: false },
      count === 1
        ? { label: named ? 'Rename\u2026' : 'Name This Person\u2026', click: () => pick('name') }
        : { label: 'Merge ' + people + '\u2026', click: () => pick('merge') },
      { label: 'Don\u2019t Feature This Person', enabled: false },
      { label: (hidden ? 'Show ' : 'Hide ') + people, click: () => pick(hidden ? 'unhide' : 'hide') },
    ]);
    activePersonMenu = menu;
    menu.popup({
      window: win,
      callback: () => setTimeout(() => {
        if (activePersonMenu === menu) activePersonMenu = null;
        pick(null);
      }, 150),
    });
  });
  return { action: chosen };
}

let activePersonPageMenu = null;

async function showPersonPageMenu(event, payload = {}) {
  const named = payload.named === true;
  const hidden = payload.hidden === true;
  const faces = payload.view === 'faces';
  const x = Math.round(Number(payload.x) || 0), y = Math.round(Number(payload.y) || 0);
  const win = BrowserWindow.fromWebContents(event.sender);
  const chosen = await new Promise((resolve) => {
    let settled = false;
    const pick = (action) => { if (settled === false) { settled = true; resolve(action); } };
    const menu = Menu.buildFromTemplate([
      { label: 'Review More Photos\u2026', click: () => pick('review') },
      { label: 'Add to Favorites', enabled: false },
      { label: named ? 'Rename\u2026' : 'Name This Person\u2026', click: () => pick('name') },
      { label: 'Don\u2019t Feature This Person', enabled: false },
      { label: hidden ? 'Show This Person' : 'Hide This Person', click: () => pick(hidden ? 'unhide' : 'hide') },
      { type: 'separator' },
      { label: 'Show:', enabled: false },
      { label: 'Photos', type: 'checkbox', checked: faces === false, click: () => pick('show-photos') },
      { label: 'Faces', type: 'checkbox', checked: faces, click: () => pick('show-faces') },
    ]);
    activePersonPageMenu = menu;
    menu.popup({
      window: win, x, y,
      callback: () => setTimeout(() => {
        if (activePersonPageMenu === menu) activePersonPageMenu = null;
        pick(null);
      }, 150),
    });
  });
  return { action: chosen };
}

let activeSortMenu = null;

async function showPeopleSortMenu(event, payload = {}) {
  const byName = payload.current === 'name';
  const x = Math.round(Number(payload.x) || 0), y = Math.round(Number(payload.y) || 0);
  const win = BrowserWindow.fromWebContents(event.sender);
  const choice = await new Promise((resolve) => {
    let settled = false;
    const pick = (c) => { if (settled === false) { settled = true; resolve(c); } };
    const menu = Menu.buildFromTemplate([
      { label: 'Sort by Name', type: 'checkbox', checked: byName, click: () => pick('name') },
      { label: 'Sort by Custom Order', type: 'checkbox', checked: byName === false, click: () => pick('custom') },
    ]);
    activeSortMenu = menu;
    menu.popup({
      window: win, x, y,
      callback: () => setTimeout(() => {
        if (activeSortMenu === menu) activeSortMenu = null;
        pick(null);
      }, 150),
    });
  });
  return { choice };
}

module.exports = [
  { channel: 'menu:show-people-sort-menu', handle: showPeopleSortMenu },
  { channel: 'menu:show-person-page-menu', handle: showPersonPageMenu },
  { channel: 'menu:show-person-context-menu', handle: showPersonContextMenu },
  { channel: 'menu:show-view-filter-menu', handle: showViewFilterMenu },
  { channel: 'menu:show-photo-context-menu', handle: showPhotoContextMenu },
  { channel: 'menu:set-sidebar-visible', handle: setSidebarVisible },
  { channel: 'menu:show-album-context-menu', handle: showAlbumContextMenu },
];
