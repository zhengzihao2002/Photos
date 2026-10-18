/**
 * IPC channels for database-only user edits (M12). Nothing here ever writes
 * to a photo file. See src/main/index/edits.js.
 *
 * edits:set-favorite
 *   Request:  { target: { filter: string } | { ids: number[] (1..1000) }, value: boolean }
 *             A filter target is the grid filter, usually with a '::sel:' segment.
 *   Response: { changed: number } -- rows whose flag actually changed.
 *   Side effect: when changed > 0, broadcasts 'library:edited' { kind: 'favorite' }
 *             to every window.
 */

const db = require('../../index/db');
const edits = require('../../index/edits');
const windowBus = require('../../window-bus');

async function setFavorite(event, payload = {}) {
  const result = edits.setFavorite(db.get(), { target: payload.target, value: payload.value });
  if (result.changed > 0) windowBus.send('library:edited', { kind: 'favorite' });
  return result;
}

module.exports = [
  { channel: 'edits:set-favorite', handle: setFavorite },
];
