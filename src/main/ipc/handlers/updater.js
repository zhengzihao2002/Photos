/**
 * IPC channels for Settings > Updates. See src/main/updater.js.
 *
 * updater:get-state  Request: none.   Response: { phase, current, latest, percent, error,
 *   releases: [{ version, notes: { en, 'zh-Hans' } }], notesIncomplete }
 * updater:check      Request: none.   Response: the same state (asks GitHub for the latest release)
 * updater:install    Request: none.   Response: the same state; on success the app quits and reopens
 * Event (window-bus): 'updater:state' with the same state object.
 * phase: 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'installing' | 'error'
 */
const updater = require('../../updater');

module.exports = [
  { channel: 'updater:get-state', handle: async () => updater.getState() },
  { channel: 'updater:check', handle: async () => updater.check() },
  { channel: 'updater:install', handle: async () => updater.install() },
];
