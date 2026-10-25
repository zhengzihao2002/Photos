/**
 * selection-sql.js -- M12.2
 *
 * The '::sel:<token>' filter segment. A grid selection travels as a compact
 * token and is turned into a SQL clause here, in the main process, so a
 * selection of any size (Cmd+A on 100,000 items) is never expanded into a
 * list of ids in the renderer.
 *
 * Token = base64url(JSON). All keys optional; unknown keys are rejected.
 *   a: 1                          everything in the grid (Cmd+A)
 *   r: [[t1, id1, t2, id2], ...]  ranges between two sort keys, either order
 *   i: [id, ...]                  individually added items
 *   x: [id, ...]                  individually removed items
 * Selected = in i, OR (not in x AND (a OR inside any range)).
 *
 * Sort key = (capture_sort, id), the grid's own order, so a range
 * stays correct when the watcher inserts items while a selection exists.
 *
 * Validated strictly before anything is inlined: times must match
 * 'YYYY-MM-DD HH:MM:SS' (no quotes possible), ids must be positive integers.
 * Invalid input throws, like every other filter in queries.js.
 */

const MAX_TOKEN_LENGTH = 2000000;
const MAX_RANGES = 1000;
const MAX_IDS = 50000;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const KEYS = new Set(['a', 'r', 'i', 'x']);

function fail(what) { throw new Error('Invalid selection: ' + what); }

function isId(v) { return Number.isInteger(v) && v > 0 && v <= 2147483647; }

function checkIds(list, name) {
  if (!Array.isArray(list)) fail(name);
  for (const v of list) if (!isId(v)) fail(name);
  return Array.from(new Set(list));
}

function compareKeys(p, q) {
  if (p.t !== q.t) return p.t < q.t ? -1 : 1;
  return p.id - q.id;
}

function decodeSelection(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH
    || !TOKEN_PATTERN.test(token)) fail('token');
  let spec;
  try { spec = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')); } catch (err) { fail('token'); }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail('token');
  for (const k of Object.keys(spec)) if (!KEYS.has(k)) fail('key ' + k);

  if (spec.a !== undefined && spec.a !== 1) fail('a');
  const all = spec.a === 1;

  const ranges = [];
  if (spec.r !== undefined) {
    if (!Array.isArray(spec.r) || spec.r.length > MAX_RANGES) fail('r');
    for (const r of spec.r) {
      if (!Array.isArray(r) || r.length !== 4) fail('r');
      const p = { t: r[0], id: r[1] };
      const q = { t: r[2], id: r[3] };
      for (const k of [p, q]) {
        if (typeof k.t !== 'string' || !TIME_PATTERN.test(k.t) || !isId(k.id)) fail('r');
      }
      ranges.push(compareKeys(p, q) <= 0 ? [p, q] : [q, p]);
    }
  }

  const include = spec.i === undefined ? [] : checkIds(spec.i, 'i');
  const included = new Set(include);
  const exclude = spec.x === undefined ? [] : checkIds(spec.x, 'x').filter((id) => !included.has(id));
  if (include.length + exclude.length > MAX_IDS) fail('too many ids');

  return { all, ranges, include, exclude };
}

function keySql(k) { return "'" + k.t + "', " + k.id; }

function buildSelectionClause(token) {
  const s = decodeSelection(token);
  const covered = [];
  if (s.all) covered.push('1');
  else {
    for (const [lo, hi] of s.ranges) {
      covered.push('((capture_sort, id) >= (' + keySql(lo) + ') AND (capture_sort, id) <= (' + keySql(hi) + '))');
    }
  }
  let body = covered.length ? '(' + covered.join(' OR ') + ')' : null;
  if (body && s.exclude.length) body = '(' + body + ' AND id NOT IN (' + s.exclude.join(',') + '))';
  const inc = s.include.length ? 'id IN (' + s.include.join(',') + ')' : null;
  if (body && inc) return '(' + inc + ' OR ' + body + ')';
  return body || inc || '0';
}

// For tests and main-process callers; the renderer has its own twin.
function encodeSelection(spec) {
  return Buffer.from(JSON.stringify(spec), 'utf8').toString('base64url');
}

module.exports = { decodeSelection, buildSelectionClause, encodeSelection, MAX_IDS, MAX_RANGES };
