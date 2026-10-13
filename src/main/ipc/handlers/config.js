/**
 * IPC channels for reading/writing the app config file (see main/config.js).
 *
 * config:get
 *   Request:  none
 *   Response: the full normalized config object (config.load())
 *
 * config:update
 *   Request:  { patch: object }   // shallow-merged per top-level key,
 *              same semantics as config.js's own update()
 *   Response: the full normalized config object after the merge
 *
 * Added in M3 (grid zoom persistence) per the M0 config.js contract, which
 * anticipated a renderer-facing config write path would be needed later.
 * Generic on purpose — not grid-specific — so later modules (timeline view
 * preferences, sidebar state, etc.) can reuse the same two channels rather
 * than each adding their own single-purpose config channel.
 */

const config = require('../../config');

async function configGet() {
  return config.load();
}

async function configUpdate(event, payload = {}) {
  return config.update(payload.patch || {});
}

module.exports = [
  { channel: 'config:get', handle: configGet },
  { channel: 'config:update', handle: configUpdate },
];
