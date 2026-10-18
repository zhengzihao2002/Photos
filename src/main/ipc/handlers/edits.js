/**
 * IPC channels for database-only user edits (M12). Nothing here ever writes
 * to a photo file. See src/main/index/edits.js and edits-text.js.
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
 */

const db = require('../../index/db');
const edits = require('../../index/edits');
const text = require('../../index/edits-text');
const windowBus = require('../../window-bus');

function broadcast(kind, result) {
  if (result.changed > 0) windowBus.send('library:edited', { kind });
  return result;
}

async function setFavorite(event, p = {}) { return broadcast('favorite', edits.setFavorite(db.get(), { target: p.target, value: p.value })); }
async function setTitle(event, p = {}) { return broadcast('title', text.setTitle(db.get(), { target: p.target, value: p.value })); }
async function setCaption(event, p = {}) { return broadcast('caption', text.setCaption(db.get(), { target: p.target, value: p.value })); }
async function updateKeywords(event, p = {}) { return broadcast('keywords', text.updateKeywords(db.get(), { target: p.target, add: p.add, remove: p.remove })); }
async function keywordSuggestions(event, p = {}) { return text.keywordSuggestions(db.get(), { prefix: p.prefix, limit: p.limit }); }

module.exports = [
  { channel: 'edits:set-favorite', handle: setFavorite },
  { channel: 'edits:set-title', handle: setTitle },
  { channel: 'edits:set-caption', handle: setCaption },
  { channel: 'edits:update-keywords', handle: updateKeywords },
  { channel: 'edits:keyword-suggestions', handle: keywordSuggestions },
];
