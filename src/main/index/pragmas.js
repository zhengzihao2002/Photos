// Connection settings shared by the main-thread and worker-thread database connections.
// (Kept apart from db.js, which needs Electron for the data path, so workers and tests can load it.)
function applyPragmas(connection) {
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('temp_store = MEMORY');
  connection.pragma('cache_size = -20000');
  connection.pragma('busy_timeout = 5000');
}

module.exports = { applyPragmas };
