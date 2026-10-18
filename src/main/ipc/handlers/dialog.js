/**
 * IPC channel: dialog:pick-folders
 * Request payload:  none
 * Response:         { canceled: boolean, paths: string[] }
 *
 * Opens the native macOS folder picker with multi-select enabled. Returns
 * the chosen folder paths as-is (absolute paths — see config.js for why
 * that's the one place absolute paths legitimately appear). This handler
 * does NOT write these paths into config; the renderer/caller decides what
 * to do with the result. (M1 will be the module that actually persists
 * chosen source folders and starts scanning them.)
 */

const { dialog, BrowserWindow } = require('electron');
const { t } = require('../../i18n'); // M14

async function pickFolders(event) {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(ownerWindow, {
    properties: ['openDirectory', 'multiSelections'],
    title: t('dialog.pickFolders.title'),
  });

  return {
    canceled: result.canceled,
    paths: result.canceled ? [] : result.filePaths,
  };
}

/**
 * IPC channel: dialog:show-message   (M6)
 * Request:  { type: 'info' | 'warning', message: string, detail?: string,
 *             buttons?: string[] (1-3, default ['OK']), defaultId?: number,
 *             cancelId?: number }
 * Response: { response: number }  -- index of the clicked button
 *
 * Native sheet attached to the requesting window. Used for "nothing could
 * be added" alerts and the Remove from Library... confirmation. Inputs are
 * validated and capped so the renderer cannot build arbitrary dialogs.
 */
async function showMessage(event, payload = {}) {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const type = payload.type === 'warning' ? 'warning' : 'info';
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const buttons = Array.isArray(payload.buttons) && payload.buttons.length
    ? payload.buttons.slice(0, 3).map((b) => text(b, 40) || 'OK')
    : ['OK'];
  const index = (v, fallback) => (Number.isInteger(v) && v >= 0 && v < buttons.length ? v : fallback);
  const result = await dialog.showMessageBox(ownerWindow, {
    type,
    message: text(payload.message, 200) || t('dialog.default.message'),
    detail: text(payload.detail, 2000) || undefined,
    buttons,
    defaultId: index(payload.defaultId, 0),
    cancelId: index(payload.cancelId, buttons.length - 1),
    noLink: true,
  });
  return { response: result.response };
}

module.exports = [
  { channel: 'dialog:pick-folders', handle: pickFolders },
  { channel: 'dialog:show-message', handle: showMessage },
];
