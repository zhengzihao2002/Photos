/**
 * safe-delete.js  (M11) -- the one function that empties a cache folder.
 *
 * A folder may only be emptied when its real path (symbolic links resolved) is exactly one of
 * the known cache folders handed in by the caller; the folder must lie inside the data root
 * with a path-separator boundary ("/data" does not cover "/data-evil"); entries are removed
 * without following symbolic links (a link is deleted, never what it points to); and nothing
 * outside those folders can be reached. The write guard repeats the check at run time.
 */
const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

function insideStrict(child, parent) {
  const p = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(p) && child !== parent;
}

/**
 * @param {string} dir  folder whose contents are removed
 * @param {{dataRoot:string, cacheDirs:string[], minAgeMs?:number}} opts
 */
async function emptyCacheDir(dir, { dataRoot, cacheDirs, minAgeMs = 0 }) {
  const root = fs.realpathSync(dataRoot);
  const real = fs.realpathSync(dir);
  const known = cacheDirs.map((d) => { try { return fs.realpathSync(d); } catch (e) { return null; } }).filter(Boolean);
  if (!insideStrict(real, root) || !known.includes(real)) {
    throw new Error('storage: refusing to clear a folder that is not one of the app’s cache folders: ' + real);
  }
  const now = Date.now();
  let removed = 0;
  for (const name of await fsp.readdir(real)) {
    const p = path.join(real, name);
    if (minAgeMs > 0) {
      try { if (now - (await fsp.lstat(p)).mtimeMs < minAgeMs) continue; } catch (e) { continue; }
    }
    await fsp.rm(p, { recursive: true, force: true }); // rm never follows a symbolic link
    removed += 1;
  }
  return removed;
}

module.exports = { emptyCacheDir, insideStrict };
