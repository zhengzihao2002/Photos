/**
 * IPC channels for Settings > Storage (M8c.6). See src/main/storage/storage.js.
 * No paths are returned.
 *
 * storage:get    Request: { force?: boolean }
 *                Response: { total, rows: [{ key, label, bytes, clear }], freeBytes, ms }
 * storage:clear  Request: { kind: 'thumbnails'|'previews'|'faceCrops'|'webCache'|'logs'|'all' }
 *                Response: { ok: true, sizes } | { ok: false, reason: 'cancelled'|'busy' }
 *                Asks first (native dialog over the requesting window).
 * Event (window-bus): 'storage:cleared' { kind }
 */
const { BrowserWindow } = require('electron');
const storage = require('../../storage/storage');

async function get(event, payload = {}) {
  return storage.getSizes({ force: !!payload && payload.force === true });
}

async function clear(event, payload = {}) {
  const kind = payload && typeof payload.kind === 'string' ? payload.kind : '';
  return storage.clear(kind, BrowserWindow.fromWebContents(event.sender));
}

module.exports = [
  { channel: 'storage:get', handle: get },
  { channel: 'storage:clear', handle: clear },
];
