/**
 * source-guard.js  (M11) -- keeps the write guard's list of source folders equal to the database.
 * Called at launch and after every add / remove / relink of a source folder.
 */
const db = require('./db');
const writeGuard = require('../write-guard');

function sync() {
  const rows = db.get().prepare('SELECT root_path FROM source_folders').all();
  writeGuard.setSourceRoots(rows.map((r) => r.root_path));
  writeGuard.broadcastSourceRoots();
}

module.exports = { sync };
