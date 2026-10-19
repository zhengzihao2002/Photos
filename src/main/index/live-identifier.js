/**
 * live-identifier.js (M15.3)
 *
 * Reads the Live Photo Content Identifier. Read-only and bounded:
 *  - stills: Apple MakerNote tag 0x0011 inside the first 512 KB of the file
 *  - videos: the container tag com.apple.quicktime.content.identifier
 * Every failure returns null, which means "not paired by identifier".
 */
const fs = require('fs');

const MAX_READ_BYTES = 512 * 1024;
const MAKERNOTE_MAGIC = Buffer.from('Apple iOS\0', 'latin1');
const TAG_CONTENT_IDENTIFIER = 0x0011;
const UUID_PATTERN = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

function normalizeIdentifier(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\0/g, '').trim().replace(/^\{|\}$/g, '').toUpperCase();
  return UUID_PATTERN.test(cleaned) ? cleaned : null;
}

// Parses an Apple MakerNote that starts at buf[start] ("Apple iOS\0" header).
// Layout (verified on a real file): header(10) + version(2) + "MM"/"II" + entry
// count(2) + 12-byte entries. Value offsets are relative to buf[start].
function parseAppleMakerNote(buf, start) {
  const bo = start + 12;
  if (bo + 4 > buf.length) return null;
  const order = buf.toString('latin1', bo, bo + 2);
  if (order !== 'MM' && order !== 'II') return null;
  const be = order === 'MM';
  const u16 = (o) => (o + 2 <= buf.length ? (be ? buf.readUInt16BE(o) : buf.readUInt16LE(o)) : null);
  const u32 = (o) => (o + 4 <= buf.length ? (be ? buf.readUInt32BE(o) : buf.readUInt32LE(o)) : null);

  const count = u16(bo + 2);
  if (count === null || count > 512) return null;

  for (let i = 0; i < count; i += 1) {
    const entry = bo + 4 + i * 12;
    const tag = u16(entry);
    if (tag === null) return null;
    if (tag !== TAG_CONTENT_IDENTIFIER) continue;
    const type = u16(entry + 2);
    const length = u32(entry + 4);
    if (type !== 2 || length === null || length < 1 || length > 128) return null;
    let dataStart = entry + 8;
    if (length > 4) {
      const off = u32(entry + 8);
      if (off === null) return null;
      dataStart = start + off;
    }
    if (dataStart + length > buf.length) return null;
    return normalizeIdentifier(buf.toString('latin1', dataStart, dataStart + length));
  }
  return null;
}

function extractStillIdentifierFromBuffer(buf) {
  try {
    let from = 0;
    for (let tries = 0; tries < 4; tries += 1) {
      const at = buf.indexOf(MAKERNOTE_MAGIC, from);
      if (at < 0) return null;
      const id = parseAppleMakerNote(buf, at);
      if (id) return id;
      from = at + 1;
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function readStillIdentifier(fullPath) {
  let handle;
  try {
    handle = await fs.promises.open(fullPath, 'r');
    const buf = Buffer.alloc(MAX_READ_BYTES);
    const { bytesRead } = await handle.read(buf, 0, MAX_READ_BYTES, 0);
    return extractStillIdentifierFromBuffer(buf.subarray(0, bytesRead));
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// probeResult is the ffprobe JSON that extract-video.js already has.
function videoIdentifierFromProbe(probeResult) {
  const tags = (probeResult && probeResult.format && probeResult.format.tags) || {};
  for (const key of Object.keys(tags)) {
    if (key.toLowerCase() === 'com.apple.quicktime.content.identifier') {
      return normalizeIdentifier(tags[key]);
    }
  }
  return null;
}

module.exports = {
  normalizeIdentifier,
  parseAppleMakerNote,
  extractStillIdentifierFromBuffer,
  readStillIdentifier,
  videoIdentifierFromProbe,
};
