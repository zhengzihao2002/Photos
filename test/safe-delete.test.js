const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { emptyCacheDir } = require('../src/main/storage/safe-delete');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'del-'));
const DATA = path.join(base, 'PhotosData'); const THUMBS = path.join(DATA, 'thumbnails');
const EVIL = path.join(base, 'PhotosData-evil'); const SRC = path.join(base, 'Source');
for (const d of [THUMBS, EVIL, SRC]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(SRC, 'a.jpg'), 'orig'); fs.writeFileSync(path.join(EVIL, 'keep'), 'k'); fs.writeFileSync(path.join(DATA, 'library.db'), 'db');
const opts = { dataRoot: DATA, cacheDirs: [THUMBS] };

test('empties a known cache folder, and only its contents', async () => {
  fs.mkdirSync(path.join(THUMBS, 'ab')); fs.writeFileSync(path.join(THUMBS, 'ab', '1_sm.jpg'), 'x'); fs.writeFileSync(path.join(THUMBS, 'x'), 'x');
  assert.strictEqual(await emptyCacheDir(THUMBS, opts), 2);
  assert.deepStrictEqual(fs.readdirSync(THUMBS), []);
  assert.ok(fs.existsSync(path.join(DATA, 'library.db')));
});

test('a symbolic link inside a cache is removed, never followed', async () => {
  fs.symlinkSync(SRC, path.join(THUMBS, 'link'));
  fs.symlinkSync(path.join(SRC, 'a.jpg'), path.join(THUMBS, 'filelink'));
  await emptyCacheDir(THUMBS, opts);
  assert.strictEqual(fs.readFileSync(path.join(SRC, 'a.jpg'), 'utf8'), 'orig');
  assert.deepStrictEqual(fs.readdirSync(THUMBS), []);
});

test('hostile folders are refused', async () => {
  for (const bad of [DATA, SRC, EVIL, base, os.homedir(), '/', path.join(THUMBS, '..'), path.join(DATA, 'nonexistent')]) {
    await assert.rejects(() => emptyCacheDir(bad, opts), /refusing|ENOENT/, bad);
  }
  fs.symlinkSync(SRC, path.join(DATA, 'cachelink'));                    // a "cache folder" that is really a link to a source folder
  await assert.rejects(() => emptyCacheDir(path.join(DATA, 'cachelink'), { dataRoot: DATA, cacheDirs: [path.join(DATA, 'cachelink')] }), /refusing/);
  assert.strictEqual(fs.readFileSync(path.join(SRC, 'a.jpg'), 'utf8'), 'orig');
  assert.ok(fs.existsSync(path.join(EVIL, 'keep')));
});

test('a sibling whose name starts with the data folder name is not inside it', async () => {
  await assert.rejects(() => emptyCacheDir(EVIL, { dataRoot: DATA, cacheDirs: [EVIL] }), /refusing/);
  assert.ok(fs.existsSync(path.join(EVIL, 'keep')));
});
