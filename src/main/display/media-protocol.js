/**
 * media-protocol.js (M5)
 *
 * The photos-media:// scheme: the ONLY way the renderer reads originals and
 * display derivatives. Accepts item ids, never paths.
 *
 *   photos-media://item/<id>/original   native image or playable video
 *   photos-media://item/<id>/display    cached JPEG (HEIC/RAW/TIFF) or MP4 copy (B.7)
 *   photos-media://item/<id>/live       Live Photo's paired video
 *   (an optional ?v=<stamp> query is ignored here; it only busts caches)
 *
 * id must be a positive integer; route must be one of the three. The path
 * comes only from display-service.resolveFile(). Files are opened read-only.
 *
 * Range: supports "bytes=a-b", "bytes=a-", "bytes=-n" (single range).
 * 206 + Content-Range for partial, 416 when unsatisfiable, 200 otherwise.
 * Hand-written rather than net.fetch(file://) because that path has a
 * history of breaking <video> seeking under custom protocols.
 *
 * registerScheme() must be called BEFORE app 'ready'; handle() after.
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { protocol } = require('electron');
const service = require('./display-service');

const ROUTES = new Set(['original', 'display', 'live']);
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: service.SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  }]);
}

function plain(status, text, extra) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain', ...(extra || {}) } });
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

async function serve(request) {
  let url;
  try { url = new URL(request.url); } catch (e) { return plain(400, 'Bad URL'); }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname !== 'item' || parts.length !== 2 || !/^\d+$/.test(parts[0]) || !ROUTES.has(parts[1])) {
    return plain(400, 'Bad request');
  }
  const id = Number(parts[0]);
  const route = parts[1];

  const file = await service.resolveFile(id, route);
  if (!file) return plain(404, 'Not found');
  let st;
  try { st = await fs.promises.stat(file); } catch (e) { return plain(404, 'Not found'); }
  if (!st.isFile()) return plain(404, 'Not found');

  const size = st.size;
  // M6 B.7: /display may now be a JPEG or an MP4 video copy; type by extension.
  const ext = path.extname(file).slice(1).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  };

  const rangeHeader = request.headers.get('range');
  let start = 0, end = size - 1, status = 200;
  if (rangeHeader && size > 0) {
    const r = parseRange(rangeHeader, size);
    if (r === 'unsatisfiable') return plain(416, 'Range not satisfiable', { 'Content-Range': 'bytes */' + size });
    if (r) { start = r.start; end = r.end; status = 206; headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size; }
  }
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
  if (size === 0) return new Response(null, { status: 200, headers });

  const body = Readable.toWeb(fs.createReadStream(file, { flags: 'r', start, end }));
  return new Response(body, { status, headers });
}

function handle() {
  protocol.handle(service.SCHEME, (request) =>
    serve(request).catch((err) => {
      console.error('[media-protocol]', err && err.message);
      return plain(500, 'Internal error');
    })
  );
}

module.exports = { registerScheme, handle };
