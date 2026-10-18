/**
 * ipc/index.js
 *
 * Central IPC registry for the main process. Every request/response channel
 * is a small "handler module" (see ipc/handlers/*.js) exporting:
 *
 *   { channel: 'namespace:action', handle: async (event, payload) => result }
 *
 * This file's only job is to wire each one to ipcMain.handle(). Nothing
 * about a channel's behavior lives here — that keeps this file from growing
 * into the "one giant switch statement" the M0 spec explicitly warns against.
 */

const { ipcMain } = require('electron');

const systemHandlers = require('./handlers/system');
const dialogHandlers = require('./handlers/dialog');
const scanHandlers = require('./handlers/scan');
const sourceHandlers = require('./handlers/source');
const libraryHandlers = require('./handlers/library');
const thumbnailHandlers = require('./handlers/thumbnail');
const configHandlers = require('./handlers/config');
const mediaHandlers = require('./handlers/media');
const menuHandlers = require('./handlers/menu');
const mapHandlers = require('./handlers/map');
const peopleHandlers = require('./handlers/people'); // M10
const infoHandlers = require('./handlers/info'); // M8c.2b
const storageHandlers = require('./handlers/storage'); // M8c.6
const editsHandlers = require('./handlers/edits'); // M12

const handlers = [
  ...systemHandlers,
  ...dialogHandlers,
  ...scanHandlers,
  ...sourceHandlers,
  ...libraryHandlers,
  ...thumbnailHandlers,
  ...configHandlers,
  ...mediaHandlers,
  ...menuHandlers,
  ...mapHandlers,
  ...peopleHandlers,
  ...infoHandlers,
  ...storageHandlers,
  ...editsHandlers,
];

function registerIpcHandlers() {
  for (const { channel, handle } of handlers) {
    ipcMain.handle(channel, handle);
  }
}

module.exports = { registerIpcHandlers, handlers };
