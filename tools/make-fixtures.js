#!/usr/bin/env node
/**
 * tools/make-fixtures.js  (M8d / M11) -- generates a small test library of real files.
 *
 *   node tools/make-fixtures.js <outDir> [--count 120] [--no-video]
 *
 * Fixtures only: EXIF dates and GPS are written into these generated files, never into anything
 * of a user's. Formats: JPEG (dated, some with GPS at well-known landmarks), PNG, GIF, WebP, TIFF,
 * BMP and, when `sips` exists (macOS), HEIC; plus short videos made with the bundled ffmpeg (one
 * MP4 that plays as is, one AVI that needs converting). A hidden manifest, .fixture-manifest.json,
 * says what the app should find (the scanner ignores hidden files).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const out = process.argv[2];
if (!out) { console.error('usage: node tools/make-fixtures.js <outDir> [--count N] [--no-video]'); process.exit(2); }
const count = Number(process.argv.includes('--count') ? process.argv[process.argv.indexOf('--count') + 1] : 120);
const withVideo = !process.argv.includes('--no-video');

const dms = (deg) => { const a = Math.abs(deg); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const s = Math.round(((a - d) * 60 - m) * 60 * 100); return d + '/1 ' + m + '/1 ' + s + '/100'; };
const SPOTS = {
  eiffel: [48.8584, 2.2945, 'Eiffel Tower'],
  goldengate: [37.8199, -122.4783, 'Golden Gate Bridge'],
  tahoe: [39.0968, -120.0324, 'Lake Tahoe'],
};

async function jpeg(file, i, extra = {}) {
  const color = { r: (i * 53) % 256, g: (i * 97) % 256, b: (i * 193) % 256 };
  const day = 1 + (i % 28); const month = 1 + (i % 12); const year = 2015 + (i % 9);
  const exif = { IFD0: { Make: 'FixtureCam', Model: 'F1' }, IFD2: { DateTimeOriginal: `${year}:${String(month).padStart(2, '0')}:${String(day).padStart(2, '0')} 10:${String(i % 60).padStart(2, '0')}:00` } };
  if (extra.gps) {
    exif.IFD3 = { GPSLatitudeRef: extra.gps[0] >= 0 ? 'N' : 'S', GPSLatitude: dms(extra.gps[0]), GPSLongitudeRef: extra.gps[1] >= 0 ? 'E' : 'W', GPSLongitude: dms(extra.gps[1]) };
  }
  await sharp({ create: { width: 640 + (i % 5) * 40, height: 480, channels: 3, background: color } }).withExif(exif).jpeg({ quality: 80 }).toFile(file);
}

function bmp(file, w = 64, h = 48) {
  const rowSize = Math.ceil((w * 3) / 4) * 4; const pix = rowSize * h; const buf = Buffer.alloc(54 + pix);
  buf.write('BM', 0); buf.writeUInt32LE(54 + pix, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(pix, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 54 + y * rowSize + x * 3; buf[o] = x * 4; buf[o + 1] = y * 5; buf[o + 2] = 128; }
  fs.writeFileSync(file, buf);
}

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'sub', 'deep'), { recursive: true });
  const manifest = { photos: 0, videos: 0, files: [], landmarks: {}, formats: {} };
  const note = (kind, rel) => { manifest.files.push(rel); manifest.formats[kind] = (manifest.formats[kind] || 0) + 1; };

  for (let i = 0; i < count; i++) {
    const dir = i % 3 === 0 ? out : i % 3 === 1 ? path.join(out, 'sub') : path.join(out, 'sub', 'deep');
    const rel = path.relative(out, path.join(dir, `IMG_${String(i).padStart(4, '0')}.jpg`));
    await jpeg(path.join(out, rel), i);
    manifest.photos++; note('jpeg', rel);
  }
  // photos at landmarks
  let n = count;
  for (const [key, [lat, lng, name]] of Object.entries(SPOTS)) {
    const rel = `landmark_${key}.jpg`;
    await jpeg(path.join(out, rel), n++, { gps: [lat, lng] });
    manifest.photos++; manifest.landmarks[rel] = name; note('jpeg', rel);
  }
  const img = (color) => sharp({ create: { width: 320, height: 240, channels: 3, background: color } });
  await img({ r: 10, g: 120, b: 200 }).png().toFile(path.join(out, 'plain.png')); manifest.photos++; note('png', 'plain.png');
  await img({ r: 200, g: 120, b: 10 }).webp().toFile(path.join(out, 'plain.webp')); manifest.photos++; note('webp', 'plain.webp');
  await img({ r: 90, g: 200, b: 90 }).tiff().toFile(path.join(out, 'plain.tiff')); manifest.photos++; note('tiff', 'plain.tiff');
  await img({ r: 90, g: 90, b: 200 }).gif().toFile(path.join(out, 'plain.gif')); manifest.photos++; note('gif', 'plain.gif');
  bmp(path.join(out, 'plain.bmp')); manifest.photos++; note('bmp', 'plain.bmp');
  if (process.platform === 'darwin') {
    try {
      execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', path.join(out, 'IMG_0000.jpg'), '--out', path.join(out, 'plain.heic')], { stdio: 'ignore' });
      manifest.photos++; note('heic', 'plain.heic'); manifest.hasHeic = true;
    } catch (e) { manifest.hasHeic = false; }
  }
  if (withVideo) {
    const ffmpeg = require('ffmpeg-static');
    const run = (args) => execFileSync(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'ignore' });
    run(['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', path.join(out, 'clip.mp4')]);
    manifest.videos++; note('mp4', 'clip.mp4');
    run(['-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x240:rate=15', '-c:v', 'mpeg4', path.join(out, 'sub', 'needs-conversion.avi')]);
    manifest.videos++; note('avi', 'sub/needs-conversion.avi'); manifest.convertVideo = 'sub/needs-conversion.avi';
  }
  fs.writeFileSync(path.join(out, '.fixture-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('fixtures:', manifest.photos, 'photos,', manifest.videos, 'videos ->', out);
})().catch((e) => { console.error(e); process.exit(1); });
