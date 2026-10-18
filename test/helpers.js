// Shared helpers for the Linux/macOS regression tests (no Electron needed).
const Database = require('better-sqlite3');
const { migrations } = require('../src/main/index/migrations');

const LATEST = migrations.reduce((m, x) => Math.max(m, x.version), 0);

function runMigrations(db, upTo = Infinity) {
  const current = db.pragma('user_version', { simple: true });
  for (const m of migrations.filter((x) => x.version > current && x.version <= upTo).sort((a, b) => a.version - b.version)) {
    db.transaction(() => { m.up(db); db.pragma(`user_version = ${m.version}`); })();
  }
}

function freshDb(upTo) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, upTo);
  return db;
}

module.exports = { Database, migrations, LATEST, runMigrations, freshDb };
