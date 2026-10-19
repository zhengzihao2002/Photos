const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const li = require('../src/main/index/live-identifier');

const UUID = '2369D8CA-95C1-419D-9502-14758AC0C946';

// Builds an Apple MakerNote: "Apple iOS\0" + version(2) + order(2) + count(2)
// + 12-byte entries + 4-byte next-IFD + data. Value offsets are relative to
// the start of the note, as in the real file inspected in M15.3.
function makeNote({ order = 'MM', uuid = UUID, extra = 0, type = 2, length = null }) {
  const be = order === 'MM';
  const w16 = (b, v, o) => (be ? b.writeUInt16BE(v, o) : b.writeUInt16LE(v, o));
  const w32 = (b, v, o) => (be ? b.writeUInt32BE(v, o) : b.writeUInt32LE(v, o));
  const count = extra + 1;
  const head = Buffer.alloc(16);
  head.write('Apple iOS\0', 0, 'latin1');
  head.writeUInt16BE(1, 10);
  head.write(order, 12, 'latin1');
  w16(head, count, 14);
  const entries = Buffer.alloc(count * 12);
  for (let i = 0; i < extra; i += 1) {
    w16(entries, 0x0001 + i, i * 12);
    w16(entries, 9, i * 12 + 2);
    w32(entries, 1, i * 12 + 4);
    w32(entries, 7, i * 12 + 8);
  }
  const data = Buffer.from(uuid + '\0', 'latin1');
  const dataOffset = 16 + entries.length + 4;
  const e = extra * 12;
  w16(entries, 0x0011, e);
  w16(entries, type, e + 2);
  w32(entries, length === null ? data.length : length, e + 4);
  w32(entries, dataOffset, e + 8);
  return Buffer.concat([head, entries, Buffer.alloc(4), data]);
}

const pad = (n) => Buffer.alloc(n, 0x41);

test('normalizeIdentifier accepts and cleans UUIDs', () => {
  assert.strictEqual(li.normalizeIdentifier(UUID.toLowerCase()), UUID);
  assert.strictEqual(li.normalizeIdentifier('  {' + UUID + '}\0 '), UUID);
});

test('normalizeIdentifier rejects bad input', () => {
  for (const v of [null, undefined, 42, '', 'hello', UUID.slice(1), UUID + '0', 'ZZZZZZZZ-95C1-419D-9502-14758AC0C946']) {
    assert.strictEqual(li.normalizeIdentifier(v), null);
  }
});

test('reads the identifier, big-endian', () => {
  const buf = Buffer.concat([pad(1848), makeNote({ order: 'MM' }), pad(50)]);
  assert.strictEqual(li.extractStillIdentifierFromBuffer(buf), UUID);
});

test('reads the identifier, little-endian', () => {
  const buf = Buffer.concat([pad(37), makeNote({ order: 'II' })]);
  assert.strictEqual(li.extractStillIdentifierFromBuffer(buf), UUID);
});

test('finds the tag among other entries', () => {
  const buf = Buffer.concat([pad(10), makeNote({ extra: 5 })]);
  assert.strictEqual(li.extractStillIdentifierFromBuffer(buf), UUID);
});

test('skips a decoy header and finds the real note', () => {
  const decoy = Buffer.from('Apple iOS\0garbage', 'latin1');
  const buf = Buffer.concat([pad(5), decoy, pad(5), makeNote({})]);
  assert.strictEqual(li.extractStillIdentifierFromBuffer(buf), UUID);
});

test('returns null without a MakerNote', () => {
  assert.strictEqual(li.extractStillIdentifierFromBuffer(pad(1000)), null);
  assert.strictEqual(li.extractStillIdentifierFromBuffer(Buffer.alloc(0)), null);
});

test('returns null for every truncation of a valid note', () => {
  const note = makeNote({ extra: 2 });
  for (let n = 0; n < note.length; n += 1) {
    assert.strictEqual(li.extractStillIdentifierFromBuffer(note.subarray(0, n)), null);
  }
});

test('returns null for a wrong type, oversized length, or non-UUID text', () => {
  assert.strictEqual(li.extractStillIdentifierFromBuffer(makeNote({ type: 7 })), null);
  assert.strictEqual(li.extractStillIdentifierFromBuffer(makeNote({ length: 500 })), null);
  assert.strictEqual(li.extractStillIdentifierFromBuffer(makeNote({ uuid: 'not-a-uuid-at-all-not-a-uuid-at-all-xx' })), null);
});

test('survives random garbage after the header', () => {
  const head = Buffer.from('Apple iOS\0', 'latin1');
  for (let i = 0; i < 200; i += 1) {
    const buf = Buffer.concat([head, Buffer.from(Array.from({ length: 80 }, () => Math.floor(Math.random() * 256)))]);
    assert.doesNotThrow(() => li.extractStillIdentifierFromBuffer(buf));
  }
});

test('readStillIdentifier reads a file and fails soft', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liv-'));
  try {
    const good = path.join(dir, 'a.heic');
    fs.writeFileSync(good, Buffer.concat([pad(1848), makeNote({})]));
    const none = path.join(dir, 'b.heic');
    fs.writeFileSync(none, pad(3000));
    assert.strictEqual(await li.readStillIdentifier(good), UUID);
    assert.strictEqual(await li.readStillIdentifier(none), null);
    assert.strictEqual(await li.readStillIdentifier(path.join(dir, 'missing.heic')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readStillIdentifier ignores a note beyond the 512 KB window', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liv-'));
  try {
    const f = path.join(dir, 'far.heic');
    fs.writeFileSync(f, Buffer.concat([pad(600 * 1024), makeNote({})]));
    assert.strictEqual(await li.readStillIdentifier(f), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('videoIdentifierFromProbe reads the container tag', () => {
  const key = 'com.apple.quicktime.content.identifier';
  assert.strictEqual(li.videoIdentifierFromProbe({ format: { tags: { [key]: UUID } } }), UUID);
  assert.strictEqual(li.videoIdentifierFromProbe({ format: { tags: { [key.toUpperCase()]: UUID.toLowerCase() } } }), UUID);
  assert.strictEqual(li.videoIdentifierFromProbe({ format: { tags: { [key]: 'junk' } } }), null);
  assert.strictEqual(li.videoIdentifierFromProbe({ format: { tags: {} } }), null);
  assert.strictEqual(li.videoIdentifierFromProbe({ format: {} }), null);
  assert.strictEqual(li.videoIdentifierFromProbe(null), null);
});
