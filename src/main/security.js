/**
 * security.js  (M11)
 *
 * Hardening that applies to every window:
 *  - navigation: a page may not navigate anywhere (links, drops, scripts);
 *  - new windows: always denied; only an explicit https allowlist may open in the
 *    user's browser;
 *  - permissions (camera, microphone, geolocation, notifications, ...): all denied;
 *  - <webview> is never allowed;
 *  - IPC: handlers only answer pages that belong to the app (isTrustedSender).
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { app, session, shell } = require('electron');

// Opened in the default browser on request (About / README links). Exact URLs, https only.
const EXTERNAL_ALLOWLIST = new Set([
  'https://github.com/zhengzihao2002/Photos',
  'https://github.com/zhengzihao2002/Photos/blob/main/THIRD_PARTY_NOTICES.md',
  'https://www.geonames.org/',
  'https://openfreemap.org/',
  'https://www.openstreetmap.org/copyright',
]);

const RENDERER_PREFIX = pathToFileURL(path.join(__dirname, '..', 'renderer')).href + '/';

function isTrustedUrl(url) {
  return typeof url === 'string' && url.startsWith(RENDERER_PREFIX);
}

/** True when an IPC event comes from one of the app's own pages (not a frame of something else). */
function isTrustedSender(event) {
  try {
    const frame = event.senderFrame;
    const url = frame ? frame.url : event.sender.getURL();
    return isTrustedUrl(url);
  } catch (e) {
    return false;
  }
}

function install() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (e, url) => {
      if (url !== contents.getURL()) e.preventDefault();
    });
    contents.on('will-redirect', (e) => e.preventDefault());
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (EXTERNAL_ALLOWLIST.has(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });
  const deny = (wc, permission, callback) => { if (typeof callback === 'function') callback(false); return false; };
  const apply = (ses) => {
    ses.setPermissionRequestHandler(deny);
    ses.setPermissionCheckHandler(() => false);
    if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
  };
  app.whenReady().then(() => apply(session.defaultSession));
}

module.exports = { install, isTrustedSender, isTrustedUrl, EXTERNAL_ALLOWLIST };
