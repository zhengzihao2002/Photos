/**
 * image-dimensions.js
 *
 * Reads true pixel width/height directly from each raster format's own
 * container header, rather than through EXIF (which is missing or unreliable
 * for JPEG and absent entirely for WEBP/BMP). Every function here reads only
 * the first few dozen bytes of a file, never loads a whole file into memory,
 * and never throws — a read or parse failure returns null, letting the
 * caller fail soft and fall back to another source (or leave dimensions
 * null).
 *
 * These are read-only: fs.promises.open(path, 'r') never truncates or
 * creates, and every handle is closed in a finally block.
 */

const fs = require('fs');

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const MAX_JPEG_HEADER_BYTES = 2 * 1024 * 1024;

async function readJpegDimensions(fullPath) {
  let handle;
  try {
    handle = await fs.promises.open(fullPath, 'r');

    const soiBuffer = Buffer.alloc(2);
    await handle.read(soiBuffer, 0, 2, 0);
    if (soiBuffer[0] !== 0xff || soiBuffer[1] !== 0xd8) return null;

    let pos = 2;
    const markerBuffer = Buffer.alloc(4);

    while (pos < MAX_JPEG_HEADER_BYTES) {
      const { bytesRead: markerBytesRead } = await handle.read(markerBuffer, 0, 2, pos);
      if (markerBytesRead < 2) return null;

      let marker = markerBuffer[1];
      let markerPos = pos;
      let fillBytes = 0;
      while (marker === 0xff && fillBytes < 8) {
        fillBytes += 1;
        markerPos += 1;
        const { bytesRead } = await handle.read(markerBuffer, 0, 2, markerPos);
        if (bytesRead < 2) return null;
        marker = markerBuffer[1];
      }
      if (markerBuffer[0] !== 0xff) return null;

      if (marker === 0xd9 || marker === 0xda) return null;

      const { bytesRead: lenBytesRead } = await handle.read(markerBuffer, 0, 2, markerPos + 2);
      if (lenBytesRead < 2) return null;
      const segmentLength = (markerBuffer[0] << 8) | markerBuffer[1];

      if (SOF_MARKERS.has(marker)) {
        const payload = Buffer.alloc(5);
        const { bytesRead: payloadBytesRead } = await handle.read(payload, 0, 5, markerPos + 4);
        if (payloadBytesRead < 5) return null;
        const height = (payload[1] << 8) | payload[2];
        const width = (payload[3] << 8) | payload[4];
        return { width, height };
      }

      pos = markerPos + 2 + segmentLength;
    }

    return null;
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

async function readWebpDimensions(fullPath) {
  let handle;
  try {
    handle = await fs.promises.open(fullPath, 'r');
    const buffer = Buffer.alloc(30);
    const { bytesRead } = await handle.read(buffer, 0, 30, 0);
    if (bytesRead < 30) return null;

    if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
    if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

    const fourCc = buffer.toString('ascii', 12, 16);

    if (fourCc === 'VP8 ') {
      if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
      const widthVal = buffer.readUInt16LE(26);
      const heightVal = buffer.readUInt16LE(28);
      return { width: widthVal & 0x3fff, height: heightVal & 0x3fff };
    }

    if (fourCc === 'VP8L') {
      if (buffer[20] !== 0x2f) return null;
      const bits = buffer.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }

    if (fourCc === 'VP8X') {
      const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
      const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
      return { width, height };
    }

    return null;
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

async function readGifDimensions(fullPath) {
  let handle;
  try {
    handle = await fs.promises.open(fullPath, 'r');
    const buffer = Buffer.alloc(10);
    const { bytesRead } = await handle.read(buffer, 0, 10, 0);
    if (bytesRead < 10) return null;

    const signature = buffer.toString('ascii', 0, 6);
    if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;

    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return { width, height };
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

async function readPngDimensions(fullPath) {
  let handle;
  try {
    handle = await fs.promises.open(fullPath, 'r');
    const buffer = Buffer.alloc(24);
    const { bytesRead } = await handle.read(buffer, 0, 24, 0);
    if (bytesRead < 24) return null;

    const signature = buffer.readUInt32BE(0);
    if (signature !== 0x89504e47) return null;
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

async function readBmpDimensions(fullPath) {
  let handle;
  try {
    handle = await fs.promises.open(fullPath, 'r');
    const buffer = Buffer.alloc(26);
    const { bytesRead } = await handle.read(buffer, 0, 26, 0);
    if (bytesRead < 26) return null;

    if (buffer.toString('ascii', 0, 2) !== 'BM') return null;

    const width = buffer.readInt32LE(18);
    const height = Math.abs(buffer.readInt32LE(22));
    return { width, height };
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

// ---- HEIC / HEIF (ISO-BMFF) -------------------------------------------
// Resolves the PRIMARY item's size: pitm -> ipma -> ipco('ispe'), plus its
// 'irot' rotation (degrees counter-clockwise). Returns RAW (un-rotated)
// dimensions; the caller decides orientation. Reads box headers and the
// 'meta' box only, never 'mdat'.

const MAX_HEIF_META_BYTES = 4 * 1024 * 1024;
const MAX_HEIF_TOP_LEVEL_BOXES = 64;

function* iterBoxes(buf, start, end) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let headerLen = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(buf.readBigUInt64BE(pos + 8));
      headerLen = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerLen || pos + size > end) return;
    yield { type, start: pos + headerLen, end: pos + size };
    pos += size;
  }
}

async function findTopLevelBox(handle, wantedType) {
  const header = Buffer.alloc(16);
  let pos = 0;
  for (let i = 0; i < MAX_HEIF_TOP_LEVEL_BOXES; i += 1) {
    const { bytesRead } = await handle.read(header, 0, 16, pos);
    if (bytesRead < 8) return null;
    let size = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    if (i === 0 && type !== 'ftyp') return null;
    let headerLen = 8;
    if (size === 1) {
      if (bytesRead < 16) return null;
      size = Number(header.readBigUInt64BE(8));
      headerLen = 16;
    } else if (size === 0) {
      return null;
    }
    if (size < headerLen) return null;
    if (type === wantedType) return { pos, size, headerLen };
    pos += size;
  }
  return null;
}

function readHeifProperty(buf, box) {
  if (box.type === 'ispe' && box.end - box.start >= 12) {
    return { type: 'ispe', width: buf.readUInt32BE(box.start + 4), height: buf.readUInt32BE(box.start + 8) };
  }
  if (box.type === 'irot' && box.end - box.start >= 1) {
    return { type: 'irot', degrees: (buf[box.start] & 0x03) * 90 };
  }
  return { type: box.type };
}

function readHeifIpma(buf, box, assoc) {
  const version = buf[box.start];
  const flags = buf.readUIntBE(box.start + 1, 3);
  let pos = box.start + 4;
  const entryCount = buf.readUInt32BE(pos);
  pos += 4;
  for (let i = 0; i < entryCount; i += 1) {
    let itemId;
    if (version < 1) { itemId = buf.readUInt16BE(pos); pos += 2; }
    else { itemId = buf.readUInt32BE(pos); pos += 4; }
    const n = buf[pos];
    pos += 1;
    const indices = [];
    for (let j = 0; j < n; j += 1) {
      let index;
      if (flags & 1) { index = buf.readUInt16BE(pos) & 0x7fff; pos += 2; }
      else { index = buf[pos] & 0x7f; pos += 1; }
      if (index > 0) indices.push(index);
    }
    assoc.set(itemId, indices);
  }
}

function parseHeifMeta(meta) {
  let primaryId = null;
  const props = [];
  const assoc = new Map();
  for (const box of iterBoxes(meta, 4, meta.length)) {
    if (box.type === 'pitm') {
      primaryId = meta[box.start] === 0 ? meta.readUInt16BE(box.start + 4) : meta.readUInt32BE(box.start + 4);
    } else if (box.type === 'iprp') {
      for (const child of iterBoxes(meta, box.start, box.end)) {
        if (child.type === 'ipco') {
          for (const prop of iterBoxes(meta, child.start, child.end)) props.push(readHeifProperty(meta, prop));
        } else if (child.type === 'ipma') {
          readHeifIpma(meta, child, assoc);
        }
      }
    }
  }
  const primaryProps = primaryId !== null && assoc.has(primaryId)
    ? assoc.get(primaryId).map((i) => props[i - 1]).filter(Boolean)
    : [];
  let ispe = primaryProps.find((p) => p.type === 'ispe');
  const irot = primaryProps.find((p) => p.type === 'irot');
  if (!ispe) {
    const all = props.filter((p) => p.type === 'ispe');
    if (all.length === 0) return null;
    ispe = all.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    return ispe.width && ispe.height ? { width: ispe.width, height: ispe.height, irotDegrees: null } : null;
  }
  if (!ispe.width || !ispe.height) return null;
  return { width: ispe.width, height: ispe.height, irotDegrees: irot ? irot.degrees : null };
}

async function readHeifDimensions(fullPath) {
  let handle;
  try {
    handle = await fs.promises.open(fullPath, 'r');
    const found = await findTopLevelBox(handle, 'meta');
    if (!found) return null;
    const bodyLen = found.size - found.headerLen;
    if (bodyLen <= 4 || bodyLen > MAX_HEIF_META_BYTES) return null;
    const meta = Buffer.alloc(bodyLen);
    const { bytesRead } = await handle.read(meta, 0, bodyLen, found.pos + found.headerLen);
    if (bytesRead < bodyLen) return null;
    return parseHeifMeta(meta);
  } catch (err) {
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

async function readContainerDimensions(fullPath, extension) {
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return readJpegDimensions(fullPath);
    case 'webp':
      return readWebpDimensions(fullPath);
    case 'gif':
      return readGifDimensions(fullPath);
    case 'png':
      return readPngDimensions(fullPath);
    case 'bmp':
      return readBmpDimensions(fullPath);
    case 'heic':
    case 'heif':
      return readHeifDimensions(fullPath);
    default:
      return null;
  }
}

module.exports = {
  readJpegDimensions,
  readWebpDimensions,
  readGifDimensions,
  readPngDimensions,
  readBmpDimensions,
  readHeifDimensions,
  readContainerDimensions,
};
