/**
 * IPC channels for database-only user edits (M12). Nothing here ever writes
 * to a photo file. See src/main/index/edits.js, edits-text.js, edit-history.js.
 *
 * Every request carries a target: { filter: string } (the grid filter, usually
 * with a '::sel:' segment) or { ids: number[] (1..1000) }. Every write
 * returns { changed: number } and, when changed > 0, broadcasts
 * 'library:edited' { kind } to every window.
 *
 * edits:set-favorite       { target, value: boolean }
 * edits:set-title          { target, value: string (<= 255 chars) }
 * edits:set-caption        { target, value: string (<= 2000 chars) }
 * edits:update-keywords    { target, add?: string[], remove?: string[] }
 * edits:keyword-suggestions { prefix: string, limit?: number (<= 20) } -> { names: string[] }
 * edits:undo / edits:redo  none -> { applied: boolean }; broadcasts library:edited when applied.
 *   Session-only, 20 steps; actions touching more than 5,000 items are not recorded.
 */

const db = require('../../index/db');
const edits = require('../../index/edits');
const text = require('../../index/edits-text');
const history = require('../../index/edit-history');
const rotate = require('../../index/edits-rotate');
const windowBus = require('../../window-bus');

function broadcast(kind, result) {
  if (result.changed > 0) windowBus.send('library:edited', { kind });
  return result;
}

async function setFavorite(event, p = {}) { return broadcast('favorite', history.recorded(db.get(), p.target, () => edits.setFavorite(db.get(), { target: p.target, value: p.value }))); }
async function setTitle(event, p = {}) { return broadcast('title', history.recorded(db.get(), p.target, () => text.setTitle(db.get(), { target: p.target, value: p.value }))); }
async function setCaption(event, p = {}) { return broadcast('caption', history.recorded(db.get(), p.target, () => text.setCaption(db.get(), { target: p.target, value: p.value }))); }
async function updateKeywords(event, p = {}) { return broadcast('keywords', history.recorded(db.get(), p.target, () => text.updateKeywords(db.get(), { target: p.target, add: p.add, remove: p.remove }))); }
async function rotateItems(event, p = {}) { return broadcast('rotate', history.recorded(db.get(), p.target, () => rotate.rotateItems(db.get(), { target: p.target, delta: p.delta }))); }
async function keywordSuggestions(event, p = {}) { return text.keywordSuggestions(db.get(), { prefix: p.prefix, limit: p.limit }); }
async function undo() { const r = history.undo(db.get()); if (r.applied) windowBus.send('library:edited', { kind: 'undo' }); return r; }
async function redo() { const r = history.redo(db.get()); if (r.applied) windowBus.send('library:edited', { kind: 'redo' }); return r; }

module.exports = [
  { channel: 'edits:set-favorite', handle: setFavorite },
  { channel: 'edits:set-title', handle: setTitle },
  { channel: 'edits:set-caption', handle: setCaption },
  { channel: 'edits:update-keywords', handle: updateKeywords },
  { channel: 'edits:keyword-suggestions', handle: keywordSuggestions },
  { channel: 'edits:rotate', handle: rotateItems }, // M12.11: { target, delta: 90 | -90 | 180 }
  { channel: 'edits:undo', handle: undo },
  { channel: 'edits:redo', handle: redo },
];
