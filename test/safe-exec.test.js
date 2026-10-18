const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../src/main/write-guard');
const { validate } = require('../src/main/safe-exec');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-'));
const SRC = path.join(base, 'Source'); const DATA = path.join(base, 'Data');
fs.mkdirSync(SRC); fs.mkdirSync(DATA);
guard.install({ allowedRoots: [DATA], sourceRoots: [SRC] });
const src = path.join(SRC, 'IMG_1.HEIC');
const ok = (file, args) => assert.doesNotThrow(() => validate(file, args));
const no = (file, args) => assert.throws(() => validate(file, args), /safe-exec refused/);

test('sips: reads are fine, conversions need --out inside the data folder', () => {
  ok('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src]);
  ok('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', '1536', src, '--out', path.join(DATA, 'o.jpg')]);
  no('/usr/bin/sips', ['-s', 'format', 'jpeg', src]);                                  // would edit the original in place
  no('/usr/bin/sips', ['-Z', '100', src]);
  no('/usr/bin/sips', ['-r', '90', src]);
  no('/usr/bin/sips', ['-s', 'format', 'jpeg', src, '--out', path.join(SRC, 'o.jpg')]); // output inside a source folder
  no('/usr/bin/sips', ['-s', 'format', 'jpeg', src, '--out', src]);                    // output = input
  no('/usr/bin/sips', ['-s', 'format', 'jpeg', src, '--out', path.join(base, 'elsewhere.jpg')]);
  no('/usr/bin/sips', ['-s', 'format', 'jpeg', src, '-o', path.join(SRC, 'o.jpg')]);
});

test('ffmpeg: one input, one output in the data folder, no stdin, no URLs', () => {
  const out = path.join(DATA, 'o.mp4');
  ok('/x/node_modules/ffmpeg-static/ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', src, '-c:v', 'copy', '-y', out]);
  ok('ffmpeg', ['-nostdin', '-ss', '1.000', '-i', src, '-frames:v', '1', '-y', path.join(DATA, 'f.jpg')]);
  no('ffmpeg', ['-i', src, '-y', out]);                                                 // no -nostdin
  no('ffmpeg', ['-nostdin', '-i', src, '-y', src]);                                     // overwrite the input
  no('ffmpeg', ['-nostdin', '-i', src, '-y', path.join(SRC, 'o.mp4')]);
  no('ffmpeg', ['-nostdin', '-i', src, '-y', 'file:' + path.join(SRC, 'o.mp4')]);
  no('ffmpeg', ['-nostdin', '-i', src, '-y', 'pipe:1']);
  no('ffmpeg', ['-nostdin', '-i', src, '-i', src, '-y', out]);                          // two inputs
  no('ffmpeg', ['-nostdin', '-i', src]);                                                // no output
  no('ffmpeg', ['-nostdin', '-i', src, '-y', path.join(base, 'elsewhere.mp4')]);
});

test('ffprobe, stat, mount, plutil: read-only forms only; anything else is refused', () => {
  ok('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', src]);
  no('ffprobe', ['-y', src]);
  ok('/usr/bin/stat', ['-f', '%Xf', src]);
  no('/usr/bin/stat', ['-f', '%Xf', src, '-x']);
  ok('/sbin/mount', []);
  no('/sbin/mount', ['-u', '/']);
  ok('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '/x/Info.plist']);
  no('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', 'x', '/x/Info.plist']);
  for (const prog of ['/bin/sh', '/usr/bin/xattr', '/usr/bin/touch', '/bin/rm', '/bin/cp', '/bin/mv', '/usr/bin/SetFile', 'rsync']) no(prog, ['-c', 'x']);
});
