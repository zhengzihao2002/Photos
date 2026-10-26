const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { compareVersions } = require('../src/main/version-compare');
const safeExec = require('../src/main/safe-exec');

test('versions compare numerically, not as text', () => {
  assert.strictEqual(compareVersions('1.0.16', '1.0.9'), 1);
  assert.strictEqual(compareVersions('v1.0.9', '1.0.16'), -1);
  assert.strictEqual(compareVersions('1.0.16', '1.0.16'), 0);
  assert.strictEqual(compareVersions('1.1', '1.0.99'), 1);
  assert.strictEqual(compareVersions('2.0.0', '1.99.99'), 1);
});

test('the update helper script is valid shell and names no photo folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  try {
    const f = path.join(dir, 's.sh');
    fs.writeFileSync(f, safeExec.UPDATE_SCRIPT);
    execFileSync('/bin/bash', ['-n', f]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(!/\$HOME|~\//.test(safeExec.UPDATE_SCRIPT));
});

test('the update helper refuses anything but the app bundle and a download in <data>/updates', () => {
  const ok = { pid: 1234, appPath: '/x/Photos.app', zipPath: '/d/updates/Photos-arm64.zip', workDir: '/d/updates' };
  assert.throws(() => safeExec.validateUpdateHelper({ ...ok, pid: 0 }), /bad pid/);
  assert.throws(() => safeExec.validateUpdateHelper({ ...ok, appPath: 'Photos.app' }), /absolute/);
  assert.throws(() => safeExec.validateUpdateHelper({ ...ok, zipPath: '/d/updates/../x.zip' }), /./);
  assert.throws(() => safeExec.validateUpdateHelper(ok), /not an app bundle/); // does not exist here
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  try {
    const app = path.join(dir, 'Photos.app');
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    assert.throws(() => safeExec.validateUpdateHelper({ ...ok, appPath: app, zipPath: path.join(dir, 'evil.zip'), workDir: dir }), /updates/);
    assert.throws(() => safeExec.validateUpdateHelper({ ...ok, appPath: path.join(dir, 'Other.txt') }), /not an app bundle/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
