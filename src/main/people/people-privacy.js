/**
 * people-privacy.js  (M10.8)
 *
 * People on/off (config.json people.enabled, default on) and "Delete All People
 * Data". Main process. Photo files are never touched; everything removed here is
 * this app's own data (database rows and the face-crops cache).
 * The window is told through 'people:privacy' { enabled, deleted }.
 */

const fs = require('fs');
const path = require('path');
const { Menu, dialog } = require('electron');
const config = require('../config');
const db = require('../index/db');
const paths = require('../paths');
const faceManager = require('../faces/face-manager');
const { buildMenu } = require('../menu');

function isEnabled() {
  const c = config.load();
  return !(c.people && c.people.enabled === false);
}

function applyMenu() {
  Menu.setApplicationMenu(buildMenu({ peopleEnabled: isEnabled() }));
}

function tell(win, payload) {
  if (win && win.isDestroyed() === false) win.webContents.send('people:privacy', payload);
}

/** At startup: menu checkbox from config; the face worker only if People is on. */
function init(mainWindow) {
  applyMenu();
  if (isEnabled()) faceManager.start({ mainWindow });
  // M10.9: once startup has settled, remove crops of faces that no longer exist.
  setTimeout(() => {
    try { console.log('face crops sweep:', JSON.stringify(require('./face-crops').sweepOrphans())); }
    catch (err) { console.warn('face crops sweep failed:', err.message); }
  }, 20000);
}

async function setEnabled(enabled, win) {
  const on = enabled === true;
  config.update({ people: { enabled: on } });
  if (on) faceManager.start({ mainWindow: win });
  else await faceManager.stop();
  applyMenu();
  tell(win, { enabled: on, deleted: false });
  return { ok: true, enabled: on };
}

async function deleteAll(win) {
  const on = isEnabled();
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Delete all People data?',
    detail: 'All faces, groups, people and names, and their crops, are removed from this app. Your photos are not touched. '
      + (on ? 'People will then find faces again from scratch.' : 'People is off, so nothing is analysed until you turn it on.'),
  });
  if (res.response !== 0) return { ok: false };

  await faceManager.stop();
  const conn = db.get();
  conn.transaction(() => {
    for (const t of ['face_rejections', 'cluster_rejections', 'person_refs']) conn.prepare('DELETE FROM ' + t).run();
    conn.prepare('UPDATE people SET cover_face_id = NULL').run();
    conn.prepare('DELETE FROM faces').run();
    conn.prepare('DELETE FROM face_clusters').run();
    conn.prepare('DELETE FROM people').run();
    conn.prepare('UPDATE items SET face_version = NULL, face_attempts = 0 WHERE face_version IS NOT NULL OR face_attempts <> 0').run();
    conn.prepare("DELETE FROM _meta WHERE key IN ('people_cluster_version', 'people_edit_seq')").run();
  })();
  // Rebuild the file so deleted face data does not linger in free pages.
  try { conn.exec('VACUUM'); } catch (err) { console.warn('People delete: VACUUM skipped:', err.message); }

  const dir = paths.faceCropsDir();
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true, recursive: true });

  if (on) faceManager.start({ mainWindow: win });
  tell(win, { enabled: on, deleted: true });
  return { ok: true };
}

module.exports = { init, isEnabled, setEnabled, deleteAll };
