/**
 * window-bus.js (M8b.2)
 *
 * The one way main-process code pushes events to the renderer. Sends to
 * every live window at the moment of sending, so nothing holds a window
 * reference that goes stale after Cmd+W and a Dock reopen. With no window
 * open the event is dropped; callers must not depend on delivery (state a
 * new window needs is fetched by request when it loads).
 */

const { BrowserWindow } = require('electron');

function send(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) continue;
    try {
      wc.send(channel, payload);
    } catch (err) {
      // window closing mid-send; dropping is the defined behaviour
    }
  }
}

module.exports = { send };
