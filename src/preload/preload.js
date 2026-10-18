/**
 * preload.js
 *
 * Runs in an isolated context with access to a limited Node/Electron API
 * even though the renderer itself has none (contextIsolation: true,
 * nodeIntegration: false, sandbox: true). This file's only job is to expose
 * a small, explicit, named API on `window.api` — never a generic
 * `invoke(anyChannel)` passthrough. Every function here maps 1:1 to a
 * channel documented in src/main/ipc/index.js.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),

  pickFolders: () => ipcRenderer.invoke('dialog:pick-folders'),
  // M6: native alert/confirm sheet; resolves to { response: buttonIndex }.
  showMessage: (options) => ipcRenderer.invoke('dialog:show-message', options),

  // M8b.2: scans go through the main-process queue; never rejected as busy.
  startScan: (payload) => ipcRenderer.invoke('scan:enqueue', payload),
  enqueueScan: (payload) => ipcRenderer.invoke('scan:enqueue', payload),
  getScanQueueState: () => ipcRenderer.invoke('scan:get-queue-state'),
  onScanQueueState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('scan:queue-state', listener);
    return () => ipcRenderer.removeListener('scan:queue-state', listener);
  },
  // M8b.7: a source folder went missing or came back: [{ sourceFolderId, status }].
  onSourceStatusChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('source:status-changed', listener);
    return () => ipcRenderer.removeListener('source:status-changed', listener);
  },

  addSource: (payload) => ipcRenderer.invoke('source:add', payload),
  listSources: () => ipcRenderer.invoke('source:list'),
  removeSource: (payload) => ipcRenderer.invoke('source:remove', payload),
  relinkSource: (payload) => ipcRenderer.invoke('source:relink', payload),

  getItemsPage: (payload) => ipcRenderer.invoke('library:get-items-page', payload),
  getTotalCount: (payload) => ipcRenderer.invoke('library:get-total-count', payload),
  getCountsByYearMonth: (payload) => ipcRenderer.invoke('library:get-counts-by-year-month', payload),
  getCountsByDate: (payload) => ipcRenderer.invoke('library:get-counts-by-date', payload),
  getItemById: (payload) => ipcRenderer.invoke('library:get-item-by-id', payload),
  getItemIndex: (payload) => ipcRenderer.invoke('library:get-item-index', payload),
  // M8c.2b: Info window (see src/main/ipc/handlers/info.js).
  toggleInfo: () => ipcRenderer.invoke('info:toggle'),
  setInfoOpen: (open) => ipcRenderer.invoke('info:set-open', { open: open === true }),
  getInfoState: () => ipcRenderer.invoke('info:get-state'),
  setInfoItem: (id) => ipcRenderer.invoke('info:set-item', { id: Number.isInteger(id) ? id : null }),
  setInfoSelection: (filter) => ipcRenderer.invoke('info:set-selection', { filter: typeof filter === 'string' ? filter : null }), // M12.6
  getSelectionSummary: (filter) => ipcRenderer.invoke('selection:get-summary', { filter }), // M12.6
  onInfoSelection: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('info:selection', listener);
    return () => ipcRenderer.removeListener('info:selection', listener);
  },
  setInfoHeight: (height) => ipcRenderer.invoke('info:set-height', { height: Number(height) }),
  onInfoVisibility: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('info:visibility', listener);
    return () => ipcRenderer.removeListener('info:visibility', listener);
  },
  onInfoItem: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('info:item', listener);
    return () => ipcRenderer.removeListener('info:item', listener);
  },
  // M8c.6: Settings > Storage (see src/main/ipc/handlers/storage.js).
  getStorage: (opts) => ipcRenderer.invoke('storage:get', { force: !!(opts && opts.force) }),
  clearStorage: (kind) => ipcRenderer.invoke('storage:clear', { kind: String(kind || '') }),
  onStorageCleared: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('storage:cleared', listener);
    return () => ipcRenderer.removeListener('storage:cleared', listener);
  },
  getReextractionCounts: () => ipcRenderer.invoke('library:get-reextraction-counts'),
  getMediaTypeCounts: () => ipcRenderer.invoke('library:get-media-type-counts'),
  getPhotoVideoCounts: (payload) => ipcRenderer.invoke('library:get-photo-video-counts', payload),
  // M12.3: favorites (database only). Target = { filter } or { ids }.
  setFavorite: (payload) => ipcRenderer.invoke('edits:set-favorite', payload),
  setTitle: (payload) => ipcRenderer.invoke('edits:set-title', payload),
  setInfoEditing: (editing) => ipcRenderer.invoke('info:set-editing', { editing: Boolean(editing) }), // M12.4
  setCaption: (payload) => ipcRenderer.invoke('edits:set-caption', payload),
  updateKeywords: (payload) => ipcRenderer.invoke('edits:update-keywords', payload),
  keywordSuggestions: (payload) => ipcRenderer.invoke('edits:keyword-suggestions', payload),
  // M12.3: Image > Favorite menu item.
  onMenuFavorite: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('menu:favorite', listener);
    return () => ipcRenderer.removeListener('menu:favorite', listener);
  },
  // M12: fired after any user edit; { kind }.
  onLibraryEdited: (cb) => {
    const listener = (event, payload) => cb(payload);
    ipcRenderer.on('library:edited', listener);
    return () => ipcRenderer.removeListener('library:edited', listener);
  },
  // M12.2: Edit > Select All (custom menu item); the renderer decides text vs. grid.
  onMenuSelectAll: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('menu:select-all', listener);
    return () => ipcRenderer.removeListener('menu:select-all', listener);
  },
  // M7.4: every visible GPS item as parallel typed arrays, newest first
  // ({ count, ids, lats, lngs, times, queryMs }); ids and coordinates only.
  getMapPoints: () => ipcRenderer.invoke('map:get-points'),
  // M7.6g: one map area as oldest-first ids plus place/date sections
  // ({ count, ids, sections }); filter must be a 'geo:' string.
  getMapAreaSections: (filter) => ipcRenderer.invoke('map:get-area-sections', { filter: String(filter) }),
  // M10 People (see src/main/ipc/handlers/people.js for shapes).
  listPeople: (opts) => ipcRenderer.invoke('people:list', { scope: opts && opts.scope === 'unnamed' ? 'unnamed' : 'named' }),
  listPeopleGroups: () => ipcRenderer.invoke('people:list-groups'),
  // M10.8: View > People on/off and Delete All People Data.
  getPeopleEnabled: () => ipcRenderer.invoke('people:get-enabled'),
  onPeoplePrivacy: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('people:privacy', listener);
    return () => ipcRenderer.removeListener('people:privacy', listener);
  },
  unnamePerson: (id) => ipcRenderer.invoke('people:unname', { id: Number(id) }),
  setPeopleOrder: (ids) => ipcRenderer.invoke('people:set-order', { ids: Array.isArray(ids) ? ids.map(Number) : [] }),
  showPeopleSortMenu: (opts) => ipcRenderer.invoke('menu:show-people-sort-menu', {
    current: opts && opts.current === 'name' ? 'name' : 'custom', x: Number(opts && opts.x) || 0, y: Number(opts && opts.y) || 0 }),
  getPerson: (id) => ipcRenderer.invoke('people:get', { id: Number(id) }),
  getPeopleForItem: (itemId) => ipcRenderer.invoke('people:get-for-item', { itemId: Number(itemId) }),
  getPeopleCovers: (ids) => ipcRenderer.invoke('people:get-covers', { ids: Array.isArray(ids) ? ids.map(Number) : [] }),
  getPersonClusters: (id) => ipcRenderer.invoke('people:get-clusters', { id: Number(id) }),
  getPersonFaces: (id) => ipcRenderer.invoke('people:get-faces', { id: Number(id) }),
  getPersonSuggestions: (id) => ipcRenderer.invoke('people:get-suggestions', { id: Number(id) }),
  getClusterFaces: (clusterId) => ipcRenderer.invoke('people:get-cluster-faces', { clusterId: Number(clusterId) }),
  addClusterToPerson: (personId, clusterId) => ipcRenderer.invoke('people:add-cluster', { personId: Number(personId), clusterId: Number(clusterId) }),
  rejectClusterForPerson: (personId, clusterId) => ipcRenderer.invoke('people:reject-cluster', { personId: Number(personId), clusterId: Number(clusterId) }),
  setPersonKeyPhoto: (personId, itemId) => ipcRenderer.invoke('people:set-key-photo', { personId: Number(personId), itemId: Number(itemId) }),
  getFaceCrops: (faceIds) => ipcRenderer.invoke('people:get-face-crops', { faceIds: Array.isArray(faceIds) ? faceIds.map(Number) : [] }),
  removeFaceFromPerson: (personId, faceId) => ipcRenderer.invoke('people:remove-face', { personId: Number(personId), faceId: Number(faceId) }),
  showPersonPageMenu: (opts) => ipcRenderer.invoke('menu:show-person-page-menu', {
    named: Boolean(opts && opts.named), hidden: Boolean(opts && opts.hidden), view: opts && opts.view === 'faces' ? 'faces' : 'photos',
    x: Number(opts && opts.x) || 0, y: Number(opts && opts.y) || 0 }),
  showPersonContextMenu: (opts) => ipcRenderer.invoke('menu:show-person-context-menu', {
    count: Number(opts && opts.count) || 1, named: Boolean(opts && opts.named), hidden: Boolean(opts && opts.hidden) }),
  // M10.7 corrections (database only).
  renamePerson: (id, name, force) => ipcRenderer.invoke('people:rename', { id: Number(id), name: String(name == null ? '' : name), force: force === true }),
  mergePeople: (targetId, sourceIds) => ipcRenderer.invoke('people:merge', { targetId: Number(targetId), sourceIds: Array.isArray(sourceIds) ? sourceIds.map(Number) : [] }),
  setPersonHidden: (id, hidden) => ipcRenderer.invoke('people:set-hidden', { id: Number(id), hidden: hidden === true }),
  removePhotoFromPerson: (personId, itemId) => ipcRenderer.invoke('people:remove-item', { personId: Number(personId), itemId: Number(itemId) }),
  removeClusterFromPerson: (personId, clusterId) => ipcRenderer.invoke('people:remove-cluster', { personId: Number(personId), clusterId: Number(clusterId) }),
  // M6 (B.4): View > Hide/Show Sidebar. The listener receives no IPC event
  // object; returns an unsubscribe function (same pattern as onProgress).
  onToggleSidebar: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:toggle-sidebar', listener);
    return () => ipcRenderer.removeListener('menu:toggle-sidebar', listener);
  },
  setSidebarMenuState: (visible) => ipcRenderer.invoke('menu:set-sidebar-visible', { visible: Boolean(visible) }),
  // M6 (B.5): native right-click menu for an album; only the id is sent.
  // Resolves to { action: 'rescan' | 'relink' | 'remove' | null, newRootPath? }.
  // M6: album / All Photos view menu (All Items / Photos / Videos), dropped
  // down at (x, y) in window coordinates. Resolves to { choice }.
  showViewFilterMenu: (current, x, y) =>
    ipcRenderer.invoke('menu:show-view-filter-menu', { current: String(current), x: Number(x), y: Number(y) }),
  // M6 (B.6g): native right-click menu for a photo/video; only the id is sent.
  // Resolves to { action: 'info' | 'rescan-all' | null }.
  // M10.7: personId (optional) adds Not <name> / Remove This Group on a person's page.
  showPhotoContextMenu: (itemId, personId) =>
    ipcRenderer.invoke('menu:show-photo-context-menu', { itemId: Number(itemId), personId: personId == null ? null : Number(personId) }),
  showAlbumContextMenu: (sourceFolderId) =>
    ipcRenderer.invoke('menu:show-album-context-menu', { sourceFolderId: Number(sourceFolderId) }),
  // M6 (B.5): absolute path of a File dropped from Finder (Electron 44 has no
  // File.path; webUtils is the supported replacement). Path lookup only.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // M6 (B.5): File > Rescan All Folders. Same pattern as onAddFolder.
  onRescanAll: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:rescan-all', listener);
    return () => ipcRenderer.removeListener('menu:rescan-all', listener);
  },
  // M6 (B.5): File > Add Folder... (Shift+Cmd+I). Same pattern as onToggleSidebar.
  onAddFolder: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:add-folder', listener);
    return () => ipcRenderer.removeListener('menu:add-folder', listener);
  },

  getThumbnailPaths: (payload) => ipcRenderer.invoke('thumbnail:get-path', payload),
  getThumbnailStatus: (payload) => ipcRenderer.invoke('thumbnail:get-status', payload),
  requestThumbnailPriority: (payload) => ipcRenderer.invoke('thumbnail:request-priority', payload),
  regenerateThumbnail: (payload) => ipcRenderer.invoke('thumbnail:regenerate', payload),

  // M5 viewer display pipeline (ids only; returns photos-media:// URLs)
  getDisplaySource: (payload) => ipcRenderer.invoke('media:get-display-source', payload),
  ensureDisplay: (payload) => ipcRenderer.invoke('media:ensure-display', payload),
  setDisplayWanted: (payload) => ipcRenderer.invoke('media:set-wanted', payload),
  showInFinder: (payload) => ipcRenderer.invoke('media:show-in-finder', payload),

  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (payload) => ipcRenderer.invoke('config:update', payload),

  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('progress:update', listener);
    return () => ipcRenderer.removeListener('progress:update', listener);
  },
});
