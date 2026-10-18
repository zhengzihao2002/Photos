#!/usr/bin/env node
/**
 * tools/build-icon.js  (M9) -- renders resources/icon/icon.svg to build/icon.icns, build/icon.png
 * and a standard .iconset folder (resources/icon/icon.iconset) with sharp. The .icns file is written
 * directly (it is a simple container of PNG images), so no macOS tool is needed; CI additionally
 * checks the result with `iconutil --convert iconset` on the macOS runner.
 *   node tools/build-icon.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'resources', 'icon', 'icon.svg'));
const ICONSET = path.join(ROOT, 'resources', 'icon', 'icon.iconset');

// macOS iconset names -> pixel size, and the matching ICNS chunk types (PNG payloads).
const SET = [
  ['icon_16x16.png', 16, 'icp4'], ['icon_16x16@2x.png', 32, 'ic11'], ['icon_32x32.png', 32, 'icp5'], ['icon_32x32@2x.png', 64, 'ic12'],
  ['icon_128x128.png', 128, 'ic07'], ['icon_128x128@2x.png', 256, 'ic13'], ['icon_256x256.png', 256, 'ic08'], ['icon_256x256@2x.png', 512, 'ic14'],
  ['icon_512x512.png', 512, 'ic09'], ['icon_512x512@2x.png', 1024, 'ic10'],
];

async function png(size) {
  return sharp(SVG, { density: 72 * Math.max(1, size / 1024) * 4 }).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer();
}

(async () => {
  fs.rmSync(ICONSET, { recursive: true, force: true });
  fs.mkdirSync(ICONSET, { recursive: true });
  const cache = new Map();
  const chunks = [];
  for (const [name, size, type] of SET) {
    if (!cache.has(size)) cache.set(size, await png(size));
    const data = cache.get(size);
    fs.writeFileSync(path.join(ICONSET, name), data);
    const head = Buffer.alloc(8); head.write(type, 0, 'ascii'); head.writeUInt32BE(data.length + 8, 4);
    chunks.push(head, data);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8); header.write('icns', 0, 'ascii'); header.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.icns'), Buffer.concat([header, body]));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), cache.get(1024));
  console.log('wrote build/icon.icns (' + (body.length + 8) + ' bytes), build/icon.png and resources/icon/icon.iconset (' + SET.length + ' images)');
})().catch((e) => { console.error(e); process.exit(1); });
