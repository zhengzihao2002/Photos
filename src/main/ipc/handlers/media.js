/**
 * IPC channels for the M5 viewer's display pipeline. Logic lives in
 * src/main/display/display-service.js; this file only wires it to IPC.
 * All channels take item ids, never paths. URLs returned are
 * photos-media://item/<id>/<route>?v=<stamp> (see media-protocol.js).
 *
 * media:get-display-source
 *   Request:  { id: number }
 *   Response: { ok: true, kind: 'image'|'video'|'unplayable-video',
 *               needsDecode: boolean, url: string|null, liveUrl?: string }
 *           | { ok: false, code: 'not_found'|'source_missing' }
 *   Fast; never decodes. url is null when needsDecode or unplayable.
 *
 * media:ensure-display
 *   Request:  { id: number }
 *   Response: { ok: true, url }
 *           | { ok: false, code: 'not_found'|'source_missing'|'decode_failed'|'cancelled', message? }
 *   Resolves when a display derivative is ready (instant on cache hit).
 *   Adds id to the wanted list if absent.
 *
 * media:set-wanted
 *   Request:  { ids: number[] }  (current item first, then neighbors)
 *   Response: { ok: true }
 *   Replaces the wanted list; unwanted pending/running decodes are cancelled.
 *
 * media:show-in-finder   (M5.8 Info panel)
 *   Request:  { id: number }
 *   Response: { ok: true } | { ok: false, code: 'not_found'|'source_missing' }
 *   Reveals the ORIGINAL file in Finder (shell.showItemInFolder). Read-only:
 *   selects the file in a Finder window, never opens or modifies it.
 */

const fsp = require('fs').promises;
const { shell } = require('electron');
const service = require('../../display/display-service');
const db = require('../../index/db');
const queries = require('../../index/queries');

async function getDisplaySource(event, payload = {}) {
  return service.getDisplaySource(Number(payload.id));
}

async function ensureDisplay(event, payload = {}) {
  return service.ensureDisplay(Number(payload.id));
}

async function setWanted(event, payload = {}) {
  service.setWanted(Array.isArray(payload.ids) ? payload.ids.map(Number) : []);
  return { ok: true };
}

async function showInFinder(event, payload = {}) {
  const id = Number(payload.id);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, code: 'not_found' };
  const item = queries.getItemById(db.get(), id);
  if (!item || !item.absolute_path) return { ok: false, code: 'not_found' };
  try { await fsp.access(item.absolute_path); } catch (e) { return { ok: false, code: 'source_missing' }; }
  shell.showItemInFolder(item.absolute_path);
  return { ok: true };
}

module.exports = [
  { channel: 'media:get-display-source', handle: getDisplaySource },
  { channel: 'media:ensure-display', handle: ensureDisplay },
  { channel: 'media:set-wanted', handle: setWanted },
  { channel: 'media:show-in-finder', handle: showInFinder },
];
