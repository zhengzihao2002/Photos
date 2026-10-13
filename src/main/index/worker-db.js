/**
 * worker-db.js
 *
 * Opens a second, independent connection to the same library.db file, for
 * use inside the scan worker thread only. Deliberately does NOT require
 * '../paths' (which depends on Electron's `app` module) and does NOT run
 * migrations — the main-thread connection (db.js) already owns schema setup
 * before any worker is ever spawned, so this connection only ever writes
 * rows, never changes structure.
 *
 * WAL mode supports exactly this: one writer (this connection, from the
 * worker thread) plus a concurrent reader (the main-thread connection) on
 * the same file, without either blocking the other.
 */

const Database = require('better-sqlite3');
const { applyPragmas } = require('./db');

function openWorkerConnection(dbPath) {
  const connection = new Database(dbPath);
  applyPragmas(connection);
  return connection;
}

module.exports = { openWorkerConnection };
