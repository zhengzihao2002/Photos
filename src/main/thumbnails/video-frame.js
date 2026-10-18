/**
 * video-frame.js
 *
 * Extracts ONE still frame from a video into a temp JPEG using the bundled
 * ffmpeg (ffmpeg-static), so generate.js can resize it with sharp. Produces
 * the temp file only; the caller deletes it after resizing.
 *
 * Seek time: 10% of the duration or 1 second, whichever is less. If the
 * duration is unknown, the first frame (0 s) is used. -ss goes before -i
 * (fast seek), so a seek into a long video does not decode everything
 * before it. If the frame cannot be produced at the seek time, one retry
 * is made at 0 s.
 *
 * READ-ONLY GUARANTEE: ffmpeg only writes to the single output path, which
 * must be inside the temp folder and can never be the source file. The
 * source is opened for reading only.
 *
 * Rotation: ffmpeg applies the video's rotation metadata by default, and
 * phone videos matched the database's display-oriented dimensions in
 * testing, so no rotation flags are passed.
 *
 * The frame is written at the video's native size; sharp downsizes later.
 * No shell is used: paths are passed as arguments. 30 s timeout per
 * attempt; a timed-out attempt is not retried.
 *
 * Packaged app: the binary path is rewritten from app.asar to
 * app.asar.unpacked. This needs asarUnpack in the build config and is
 * untested until the app is packaged.
 *
 * Result: { ok: true, path, seekSeconds } or { ok: false, code, message }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeExecFileAsync } = require('../safe-exec'); // M11: command lines are validated before they run

const execFileAsync = safeExecFileAsync;

const ffmpegStatic = require('ffmpeg-static');
const FFMPEG_PATH = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null;
const DEFAULT_TIMEOUT_MS = 30000;

function seekTime(durationSeconds) {
  if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.min(1, durationSeconds * 0.1);
  }
  return 0;
}

function decodeFail(message) {
  return { ok: false, code: 'decode_failed', message: String(message).replace(/\s+/g, ' ').slice(0, 300) };
}

async function extractFrame({ sourcePath, tmpFolder, id, durationSeconds, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!FFMPEG_PATH) return decodeFail('ffmpeg binary is not available on this platform');

  const outPath = path.join(tmpFolder, id + '_frame.' + crypto.randomBytes(4).toString('hex') + '.jpg');
  const outResolved = path.resolve(outPath);
  if (outResolved === path.resolve(sourcePath) ||
      !outResolved.startsWith(path.resolve(tmpFolder) + path.sep)) {
    throw new Error('ffmpeg output path failed the read-only safety check');
  }

  try {
    await fs.promises.mkdir(tmpFolder, { recursive: true });
  } catch (err) {
    return { ok: false, code: 'write_failed', message: err.message };
  }

  async function attempt(seek) {
    const args = [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-ss', seek.toFixed(3), '-i', sourcePath,
      '-frames:v', '1', '-q:v', '2', '-y', outPath,
    ];
    try {
      await execFileAsync(FFMPEG_PATH, args, { timeout: timeoutMs, maxBuffer: 1 << 20 });
      const stat = await fs.promises.stat(outPath);
      if (stat.size === 0) throw new Error('ffmpeg produced an empty frame');
      return null;
    } catch (err) {
      await fs.promises.unlink(outPath).catch(() => {});
      return err;
    }
  }

  const firstSeek = seekTime(durationSeconds);
  let err = await attempt(firstSeek);
  let usedSeek = firstSeek;
  if (err && !err.killed && firstSeek > 0) {
    err = await attempt(0);
    usedSeek = 0;
  }
  if (err) {
    if (err.killed) return decodeFail('ffmpeg timed out after ' + timeoutMs + ' ms');
    return decodeFail(err.stderr || err.message);
  }
  return { ok: true, path: outPath, seekSeconds: usedSeek };
}

module.exports = { extractFrame, seekTime, FFMPEG_PATH };
