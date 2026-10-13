/**
 * sips-decode.js
 *
 * Converts formats sharp cannot decode (HEIC/HEIF/BMP and camera RAW) into
 * an intermediate JPEG using macOS's built-in `sips`, so generate.js can
 * resize it with sharp. Produces the temp file only; the caller deletes it
 * after resizing.
 *
 * READ-ONLY GUARANTEE: `sips` edits the input file in place unless --out
 * is given. Every call here passes --out pointing inside the temp folder,
 * and refuses to run if the output path is the source or lies outside the
 * temp folder.
 *
 * Downscale: -Z is passed only when the source's longest edge exceeds
 * maxEdge, so small images are never enlarged. If dimensions cannot be
 * read, the file is converted at full size (never upscaled).
 *
 * Orientation: HEIC output has rotation baked into the pixels; RAW (DNG
 * checked) output can be landscape pixels plus an EXIF orientation tag.
 * generate.js calls sharp's .rotate(), which handles both.
 *
 * RAW: full decode, about 15x slower than HEIC in testing (4.19 s for one
 * Pentax DNG), so it gets a longer timeout. Only RAW formats macOS itself
 * understands work; others return decode_failed (a soft error).
 *
 * No shell is used: paths are passed as arguments.
 *
 * Cancellation (added M5): optional AbortSignal `signal`; aborting kills the
 * sips child and returns { ok: false, code: 'cancelled' }. M2 never passes it.
 *
 * Result: { ok: true, path } or { ok: false, code, message }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const SIPS = '/usr/bin/sips';
const RAW_EXTENSIONS = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf']);
const SIPS_EXTENSIONS = new Set(['heic', 'heif', 'bmp', ...RAW_EXTENSIONS]);
const INTERMEDIATE_QUALITY = 90;
const DEFAULT_TIMEOUT_MS = 60000;
const RAW_TIMEOUT_MS = 180000;

/** Timeout for a source path, chosen from its extension. */
function timeoutFor(sourcePath) {
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  return RAW_EXTENSIONS.has(ext) ? RAW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

async function readDimensions(sourcePath, timeoutMs, signal) {
  try {
    const { stdout } = await execFileAsync(
      SIPS,
      ['-g', 'pixelWidth', '-g', 'pixelHeight', sourcePath],
      { timeout: timeoutMs, maxBuffer: 1 << 20, signal }
    );
    const w = /pixelWidth:\s*(\d+)/.exec(stdout);
    const h = /pixelHeight:\s*(\d+)/.exec(stdout);
    if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
  } catch (err) {
    // fall through: unknown dimensions means convert at full size
  }
  return null;
}

function decodeFail(message) {
  return { ok: false, code: 'decode_failed', message: String(message).slice(0, 300) };
}

async function sipsToJpeg({ sourcePath, tmpFolder, id, maxEdge = 1536, timeoutMs, signal }) {
  const timeout = timeoutMs || timeoutFor(sourcePath);
  const outPath = path.join(
    tmpFolder,
    id + '_src.' + crypto.randomBytes(4).toString('hex') + '.jpg'
  );
  const outResolved = path.resolve(outPath);
  if (outResolved === path.resolve(sourcePath) ||
      !outResolved.startsWith(path.resolve(tmpFolder) + path.sep)) {
    throw new Error('sips output path failed the read-only safety check');
  }

  try {
    await fs.promises.mkdir(tmpFolder, { recursive: true });
  } catch (err) {
    return { ok: false, code: 'write_failed', message: err.message };
  }

  const dims = await readDimensions(sourcePath, timeout, signal);
  if (signal && signal.aborted) return { ok: false, code: 'cancelled', message: 'cancelled' };
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(INTERMEDIATE_QUALITY)];
  if (dims && Math.max(dims.width, dims.height) > maxEdge) {
    args.push('-Z', String(maxEdge));
  }
  args.push(sourcePath, '--out', outPath);

  try {
    await execFileAsync(SIPS, args, { timeout, maxBuffer: 1 << 20, signal });
    const stat = await fs.promises.stat(outPath);
    if (stat.size === 0) throw new Error('sips produced an empty file');
    return { ok: true, path: outPath };
  } catch (err) {
    await fs.promises.unlink(outPath).catch(() => {});
    if (err.name === 'AbortError' || (signal && signal.aborted)) return { ok: false, code: 'cancelled', message: 'cancelled' };
    if (err.killed) return decodeFail('sips timed out after ' + timeout + ' ms');
    return decodeFail(err.stderr || err.message);
  }
}

module.exports = { sipsToJpeg, SIPS_EXTENSIONS, RAW_EXTENSIONS, timeoutFor };
