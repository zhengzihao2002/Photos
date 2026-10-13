/**
 * video-transcode.js (M6, B.7) -- playable copies of videos Chromium can't
 * play as-is: containers other than mp4/m4v/mov/webm (e.g. AVI), and files
 * with 2+ audio tracks (e.g. FaceTime recordings, where Chromium plays only
 * one track). Uses the bundled ffmpeg/ffprobe.
 *
 * READ-ONLY GUARANTEE: the source is only ever an ffmpeg INPUT (-i). Output
 * goes to a random name inside the caller's tmp folder (the display cache's
 * .tmp/), checked before running; the caller commits it into the cache.
 *
 * Video: copied untouched when H.264/HEVC (HEVC tagged hvc1 for macOS
 * playback); otherwise re-encoded to H.264. Audio: 2+ tracks mixed into one
 * (no volume normalisation); 1 track -> AAC; none -> none. MP4, faststart.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const FFMPEG = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null;
const FFPROBE = ffprobeStatic && ffprobeStatic.path ? ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked') : null;

const PLAYABLE_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm']);
const COPYABLE_VIDEO = new Set(['h264', 'hevc']);

/** Fast metadata read. Returns { videoCodec, audioCount, duration } or null. */
async function probe(sourcePath, signal) {
  if (!FFPROBE) return null;
  try {
    const { stdout } = await execFileAsync(
      FFPROBE,
      ['-v', 'error', '-print_format', 'json', '-show_streams', sourcePath],
      { timeout: 15000, maxBuffer: 4 << 20, signal }
    );
    const streams = (JSON.parse(stdout).streams) || [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.filter((s) => s.codec_type === 'audio');
    return {
      videoCodec: video ? video.codec_name : null,
      audioCount: audio.length,
      duration: Number(video && video.duration) || null,
    };
  } catch (err) {
    return null;
  }
}

/** True when the original can't be played faithfully by Chromium. */
function needsTranscode(ext, info) {
  if (!PLAYABLE_CONTAINERS.has(ext)) return true;
  return !!info && info.audioCount >= 2;
}

async function transcode({ sourcePath, tmpFolder, id, info, signal }) {
  if (!FFMPEG) return { ok: false, code: 'decode_failed', message: 'ffmpeg binary is not available' };

  const outPath = path.join(tmpFolder, id + '_video.' + crypto.randomBytes(4).toString('hex') + '.mp4');
  const outResolved = path.resolve(outPath);
  if (outResolved === path.resolve(sourcePath) ||
      !outResolved.startsWith(path.resolve(tmpFolder) + path.sep)) {
    throw new Error('ffmpeg output path failed the read-only safety check');
  }
  await fs.promises.mkdir(tmpFolder, { recursive: true });

  const audioCount = info ? info.audioCount : 1;
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', sourcePath];
  if (audioCount >= 2) {
    const inputs = Array.from({ length: audioCount }, (_, i) => '[0:a:' + i + ']').join('');
    args.push('-filter_complex', inputs + 'amix=inputs=' + audioCount + ':duration=longest:normalize=0[aout]',
      '-map', '0:v:0', '-map', '[aout]');
  } else {
    args.push('-map', '0:v:0', '-map', '0:a:0?');
  }
  if (info && COPYABLE_VIDEO.has(info.videoCodec)) {
    args.push('-c:v', 'copy');
    if (info.videoCodec === 'hevc') args.push('-tag:v', 'hvc1');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
  }
  // 48 kHz stereo: old cameras record odd rates (e.g. 11,024 Hz) that
  // Chromium's AAC decoder rejects; 48k stereo plays everywhere.
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-y', outPath);

  const seconds = (info && info.duration) || 60;
  // Whole milliseconds: Node rejects a fractional child-process timeout.
  const timeout = Math.round(Math.min(10 * 60 * 1000, Math.max(60 * 1000, seconds * 4000)));
  try {
    await execFileAsync(FFMPEG, args, { timeout, maxBuffer: 4 << 20, signal });
    const st = await fs.promises.stat(outPath);
    if (st.size === 0) throw new Error('ffmpeg produced an empty file');
    return { ok: true, path: outPath };
  } catch (err) {
    await fs.promises.unlink(outPath).catch(() => {});
    if (signal && signal.aborted) return { ok: false, code: 'cancelled', message: 'cancelled' };
    return { ok: false, code: 'decode_failed', message: String(err.message || err).replace(/\s+/g, ' ').slice(0, 300) };
  }
}

module.exports = { probe, needsTranscode, transcode, PLAYABLE_CONTAINERS };
