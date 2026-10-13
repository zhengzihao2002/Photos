const Database = require('better-sqlite3');
const paths = require('../paths');
const { migrations } = require('./migrations');

let db = null;

function applyPragmas(connection) {
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('temp_store = MEMORY');
  connection.pragma('cache_size = -20000');
  connection.pragma('busy_timeout = 5000');
}

function runMigrations(connection) {
  const currentVersion = connection.pragma('user_version', { simple: true });
  const pending = migrations
    .filter((migration) => migration.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const applyOne = connection.transaction(() => {
      migration.up(connection);
      connection.pragma(`user_version = ${migration.version}`);
    });
    applyOne();
  }
}

function get() {
  if (!db) {
    db = new Database(paths.dbPath());
    applyPragmas(db);
    runMigrations(db);
  }
  return db;
}

function close() {
  if (db) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    db = null;
  }
}

module.exports = { get, close, applyPragmas, runMigrations };
