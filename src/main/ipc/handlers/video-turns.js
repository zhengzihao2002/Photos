/**
 * IPC channels for manual video turn points (src/main/index/video-turns.js). Ids only; no paths.
 *
 * video-turns:get    Request: { id }                 Response: [{ at, turn }] sorted by at
 * video-turns:set    Request: { id, at, turn }       Response: the new list (turn: 0|90|180|270, or null to remove)
 * video-turns:clear  Request: { id }                 Response: []
 * video-turns:move   Request: { id, from, to }       Response: the new list (collisions rejected)
 */
const db = require('../../index/db');
const turns = require('../../index/video-turns');

module.exports = [
  { channel: 'video-turns:get', handle: async (event, p = {}) => turns.listTurns(db.get(), Number(p.id)) },
  { channel: 'video-turns:set', handle: async (event, p = {}) => turns.setTurn(db.get(), { id: Number(p.id), at: Number(p.at), turn: p.turn === null ? null : Number(p.turn) }) },
  { channel: 'video-turns:clear', handle: async (event, p = {}) => turns.clearTurns(db.get(), Number(p.id)) },
  { channel: 'video-turns:move', handle: async (event, p = {}) => turns.moveTurn(db.get(), { id: Number(p.id), from: Number(p.from), to: Number(p.to) }) },
];
