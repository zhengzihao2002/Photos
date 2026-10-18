/**
 * IPC channels for the Info window (M8c.2b). See src/main/info-window.js for
 * the window itself. Nothing here returns a file path; the Info page fetches
 * item details through the existing library:get-item-by-id.
 *
 * info:toggle      Request: none                    Response: { open: boolean }
 *                  Opens Info if closed, closes it if open (i button, Cmd+I).
 * info:set-open    Request: { open: boolean }       Response: { open: boolean }
 *                  e.g. Get Info always opens.
 * info:get-state   Request: none                    Response: { open: boolean, itemId: number|null }
 *                  The main window reads `open` at load (i button highlight);
 *                  the Info page reads `itemId` at load (bus events sent
 *                  before it existed are not replayed).
 * info:set-item    Request: { id: integer|null }    Response: { ok: true }
 *                  The item Info shows: the photo open in the viewer,
 *                  otherwise the grid selection, otherwise null.
 * info:set-height  Request: { height: number }      Response: { ok: true }
 *                  The Info page's content height; the window fits it.
 *
 * Events (through window-bus): 'info:visibility' { open }, 'info:item' { id }.
 */

const infoWindow = require('../../info-window');
const db = require('../../index/db');
const { getSelectionSummary } = require('../../index/selection-summary');

async function toggle() {
  infoWindow.toggle();
  return { open: infoWindow.isOpen() };
}

async function setOpen(event, payload = {}) {
  if (payload && payload.open === true) infoWindow.open();
  else if (payload && payload.open === false) infoWindow.close();
  return { open: infoWindow.isOpen() };
}

async function getState() {
  return { open: infoWindow.isOpen(), itemId: infoWindow.getItem(), selection: infoWindow.getSelection() };
}

async function setItem(event, payload = {}) {
  const id = payload ? payload.id : null;
  infoWindow.setItem(Number.isInteger(id) && id > 0 ? id : null);
  return { ok: true };
}

async function setHeight(event, payload = {}) {
  const h = payload ? Number(payload.height) : NaN;
  if (Number.isFinite(h)) infoWindow.setHeight(h);
  return { ok: true };
}

async function setEditing(event, payload = {}) {
  infoWindow.setEditing(Boolean(payload && payload.editing));
  return { ok: true };
}

async function setSelection(event, payload = {}) {
  infoWindow.setSelection(payload ? payload.filter : null);
  return { ok: true };
}

async function getSummary(event, payload = {}) {
  return getSelectionSummary(db.get(), { filter: payload && payload.filter });
}

module.exports = [
  { channel: 'info:set-selection', handle: setSelection }, // M12.6: { filter: string|null }
  { channel: 'selection:get-summary', handle: getSummary }, // M12.6: { filter } -> summary
  { channel: 'info:set-editing', handle: setEditing }, // M12.4
  { channel: 'info:toggle', handle: toggle },
  { channel: 'info:set-open', handle: setOpen },
  { channel: 'info:get-state', handle: getState },
  { channel: 'info:set-item', handle: setItem },
  { channel: 'info:set-height', handle: setHeight },
];
