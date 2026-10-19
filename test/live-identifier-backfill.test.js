const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { freshDb } = require('./helpers');
const { runIdentifierBackfill } = require('../src/main/index/live-identifier-backfill');

const UUID = '2369D8CA-95C1-419D-9502-14758AC0C946';
function still(uuid) {
  const head = Buffer.alloc(16); head.write('Apple iOS\0', 0, 'latin1'); head.writeUInt16BE(1, 10); head.write('MM', 12, 'latin1'); head.writeUInt16BE(1, 14);
  const e = Buffer.alloc(12); e.writeUInt16BE(0x11, 0); e.writeUInt16BE(2, 2); e.writeUInt32BE(37, 4); e.writeUInt32BE(32, 8);
  return Buffer.concat([Buffer.alloc(100, 0x41), head, e, Buffer.alloc(4), Buffer.from(uuid + '\0', 'latin1')]);
}

test('backfill reads stills, stamps the rest, skips missing files, and runs once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.heic'), still(UUID));
    fs.writeFileSync(path.join(dir, 'b.heic'), Buffer.alloc(500, 0x41));
    const db = freshDb();
    db.prepare("INSERT INTO source_folders (root_path, display_name, added_at) VALUES ('/a','a',0)").run();
    const ins = db.prepare("INSERT INTO items (source_folder_id, relative_path, filename, media_type, extension, file_size_bytes, file_mtime, created_at, updated_at) VALUES (1,@p,@p,'image',@e,10,7,0,5)");
    for (const [p, e] of [['a.heic', 'heic'], ['b.heic', 'heic'], ['c.png', 'png'], ['d.heic', 'heic']]) ins.run({ p, e });
    const r1 = await runIdentifierBackfill(db, 1, dir);
    const row = (p) => db.prepare('SELECT content_identifier id, live_pairing_version v, updated_at u FROM items WHERE relative_path = ?').get(p);
    assert.deepStrictEqual(row('a.heic'), { id: UUID, v: 1, u: 5 });
    assert.deepStrictEqual(row('b.heic'), { id: null, v: 1, u: 5 });
    assert.deepStrictEqual(row('c.png'), { id: null, v: 1, u: 5 });
    assert.strictEqual(row('d.heic').v, null);
    assert.strictEqual(r1.found, 1);
    assert.strictEqual(r1.skipped, 1);
    const r2 = await runIdentifierBackfill(db, 1, dir);
    assert.strictEqual(r2.read, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
