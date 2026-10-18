const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const guard = require('../src/main/write-guard');
const realFs = { ...fs }; // captured before install: used by the test itself to build fixtures

const base = realFs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
const SRC = path.join(base, 'Photos Library');          // pretend source folder
const DATA = path.join(base, 'PhotosData');             // pretend data folder
const OUTSIDE = path.join(base, 'elsewhere');
for (const d of [SRC, DATA, OUTSIDE, path.join(SRC, 'sub')]) realFs.mkdirSync(d, { recursive: true });
realFs.writeFileSync(path.join(SRC, 'a.jpg'), 'original');
realFs.writeFileSync(path.join(SRC, 'sub', 'b.jpg'), 'original');
realFs.symlinkSync(SRC, path.join(DATA, 'link-to-source'));
realFs.symlinkSync(path.join(SRC, 'a.jpg'), path.join(DATA, 'link-to-file'));

guard.install({ allowedRoots: [DATA], sourceRoots: [SRC] });

const refused = (fn) => assert.throws(fn, (e) => e.code === guard.CODE);
const refusedAsync = (p) => assert.rejects(p, (e) => e.code === guard.CODE);
const same = (name, expected = 'original') => assert.strictEqual(realFs.readFileSync(path.join(SRC, name), 'utf8'), expected);

test('writes inside the data folder work', () => {
  fs.writeFileSync(path.join(DATA, 'ok.txt'), 'x');
  fs.mkdirSync(path.join(DATA, 'd', 'e'), { recursive: true });
  fs.renameSync(path.join(DATA, 'ok.txt'), path.join(DATA, 'ok2.txt'));
  fs.rmSync(path.join(DATA, 'ok2.txt'));
  const s = fs.createWriteStream(path.join(DATA, 'stream.txt')); s.end('x');
});

test('every sync write form is refused inside a source folder', () => {
  const a = path.join(SRC, 'a.jpg'); const n = path.join(SRC, 'new.jpg');
  refused(() => fs.writeFileSync(a, 'x'));
  refused(() => fs.appendFileSync(a, 'x'));
  refused(() => fs.truncateSync(a, 0));
  refused(() => fs.unlinkSync(a));
  refused(() => fs.rmSync(a));
  refused(() => fs.rmSync(SRC, { recursive: true }));
  refused(() => fs.rmdirSync(path.join(SRC, 'sub')));
  refused(() => fs.mkdirSync(path.join(SRC, 'newdir')));
  refused(() => fs.renameSync(a, path.join(DATA, 'moved.jpg')));       // moving OUT of the source
  refused(() => fs.renameSync(path.join(DATA, 'x'), n));               // moving IN
  refused(() => fs.copyFileSync(path.join(DATA, 'y'), n));
  refused(() => fs.cpSync(DATA, path.join(SRC, 'copy'), { recursive: true }));
  refused(() => fs.utimesSync(a, 1, 1));
  refused(() => fs.chmodSync(a, 0o600));
  refused(() => fs.symlinkSync(a, path.join(SRC, 'sym')));
  refused(() => fs.linkSync(a, path.join(SRC, 'hard')));
  refused(() => fs.mkdtempSync(path.join(SRC, 'tmp-')));
  refused(() => fs.openSync(a, 'r+'));
  refused(() => fs.openSync(a, 'w'));
  refused(() => fs.openSync(a, fs.constants.O_WRONLY));
  refused(() => fs.createWriteStream(a));
  fs.readFileSync(a); fs.openSync(a, 'r'); // reading is untouched
  same('a.jpg');
});

test('callback and promise forms are refused too', async () => {
  const a = path.join(SRC, 'a.jpg');
  await new Promise((resolve) => fs.writeFile(a, 'x', (err) => { assert.strictEqual(err && err.code, guard.CODE); resolve(); }));
  await new Promise((resolve) => fs.unlink(a, (err) => { assert.strictEqual(err && err.code, guard.CODE); resolve(); }));
  await refusedAsync(fs.promises.writeFile(a, 'x'));
  await refusedAsync(fs.promises.appendFile(a, 'x'));
  await refusedAsync(fs.promises.unlink(a));
  await refusedAsync(fs.promises.rm(a));
  await refusedAsync(fs.promises.rename(a, path.join(DATA, 'q')));
  await refusedAsync(fs.promises.copyFile(path.join(DATA, 'q'), a));
  await refusedAsync(fs.promises.mkdir(path.join(SRC, 'zz')));
  await refusedAsync(fs.promises.open(a, 'a'));
  await refusedAsync(fs.promises.utimes(a, 1, 1));
  await fs.promises.readFile(a);
  same('a.jpg');
});

test('tricks: .. segments, symlinks, case and Unicode normalisation', () => {
  const a = path.join(SRC, 'a.jpg');
  refused(() => fs.writeFileSync(path.join(DATA, '..', 'Photos Library', 'a.jpg'), 'x'));          // via ..
  refused(() => fs.writeFileSync(path.join(DATA, 'link-to-source', 'a.jpg'), 'x'));                // via a symlinked folder
  refused(() => fs.writeFileSync(path.join(DATA, 'link-to-file'), 'x'));                           // via a symlinked file
  refused(() => fs.writeFileSync(path.join(DATA, 'link-to-source', 'brand-new.jpg'), 'x'));        // new file through the link
  refused(() => fs.mkdirSync(path.join(DATA, 'link-to-source', 'deep', 'er'), { recursive: true }));
  refused(() => fs.writeFileSync(path.join(base, 'PHOTOS LIBRARY', 'a.jpg'), 'x'));                // case-insensitive volume
  refused(() => fs.writeFileSync(path.join(base, 'photos library', 'A.JPG'), 'x'));
  // Unicode: a decomposed name must match a composed source folder
  const uni = path.join(base, 'Café Photos'); realFs.mkdirSync(uni);
  guard.setSourceRoots([SRC, uni]);
  refused(() => fs.writeFileSync(path.join(base, 'Café Photos', 'x.jpg'), 'x'));
  guard.setSourceRoots([SRC]);
  refused(() => fs.writeFileSync(path.join(DATA, 'bad\0name'), 'x'));
  same('a.jpg');
});

test('outside the data folder is refused even when it is not a source folder', () => {
  refused(() => fs.writeFileSync(path.join(OUTSIDE, 'x.txt'), 'x'));
  refused(() => fs.mkdirSync(path.join(OUTSIDE, 'y')));
  assert.strictEqual(guard.check(path.join(os.homedir(), 'Library', 'Preferences', 'x.plist')).ok, false);
  guard.allow(OUTSIDE);
  fs.writeFileSync(path.join(OUTSIDE, 'x.txt'), 'x'); // an explicit allowlist entry opens exactly that folder
});

test('adding a source folder at run time takes effect at once', () => {
  const added = path.join(base, 'added'); realFs.mkdirSync(added);
  guard.allow(added);
  fs.writeFileSync(path.join(added, 'x'), 'x');
  guard.setSourceRoots([SRC, added]);
  refused(() => fs.writeFileSync(path.join(added, 'y'), 'x'));
  guard.setSourceRoots([SRC]);
});

test('violations are logged and counted', () => {
  assert.ok(guard.getViolations().length > 10);
  assert.ok(guard.getViolations().every((v) => v.op && v.target && v.reason));
});
