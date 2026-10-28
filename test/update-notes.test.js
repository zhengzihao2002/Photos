const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { releaseNotes, selectReleases, loadReleaseNotes } = require('../src/main/update-notes');
const { buildNotes } = require('../tools/release-notes');
const release = (version, body = '- Changes ' + version, extra = {}) => ({ tag_name: 'v' + version, body, ...extra });
const response = (data, next = false) => ({ ok: true, json: async () => data, headers: { get: () => next ? '<https://untrusted.example/>; rel="next"' : null } });

test('only missed stable versions are shown, newest first, independent of API ordering', () => {
  const data = [release('1.2.2'), release('1.2.1'), release('1.2.10'), release('1.2.3'), release('1.2.2'),
    release('1.2.9', '', { draft: true }), release('1.2.8', '', { prerelease: true }), release('1.2.11'), release('invalid')];
  assert.deepEqual(selectReleases(data, '1.2.1', '1.2.10').map(r => r.version), ['1.2.10', '1.2.3', '1.2.2']);
  assert.deepEqual(selectReleases(data, '1.2.10', '1.2.10'), []);
});

test('bilingual release bodies round-trip through the publishing tool without install instructions', () => {
  const current = '## English\n\n- **Version history**\n- Keep notes visible.\n\n## 简体中文\n\n- 版本历史\n- 保留更新说明。';
  const body = buildNotes('1.2.3', '# Changelog\n\n## [Unreleased]\nOld unrelated changes', current);
  assert.deepEqual(releaseNotes(body), { en: '- Version history\n- Keep notes visible.', 'zh-Hans': '- 版本历史\n- 保留更新说明。' });
  assert.equal(releaseNotes('Photos 1.0.29\n\n**Install:** download...').en, '');
  assert.equal(releaseNotes(null).en, '');
  assert.equal(releaseNotes('- <img src=x onerror=alert(1)>').en, '- <img src=x onerror=alert(1)>');
  assert.equal(releaseNotes('## Fixed\n- A fix.').en, 'Fixed\n- A fix.');
  const versioned = buildNotes('1.2.3', '## [1.2.30]\nWrong\n## [1.2.3] - today\n\n- Correct\n## [1.2.2]\nOlder', current);
  assert.equal(releaseNotes(versioned).en, '- Correct');
});

test('history pagination uses only our repository and includes intermediate versions on later pages', async () => {
  const calls = [];
  const result = await loadReleaseNotes(async url => {
    calls.push(url);
    return calls.length === 1 ? response([release('1.2.3'), release('1.2.1')], true) : response([release('1.2.2')]);
  }, release('1.2.3'), '1.2.1', '1.2.3');
  assert.deepEqual(result.releases.map(r => r.version), ['1.2.3', '1.2.2']);
  assert.equal(result.notesIncomplete, false);
  assert.deepEqual(calls, [1, 2].map(page => `https://api.github.com/repos/zhengzihao2002/Photos/releases?per_page=100&page=${page}`));
});

test('unavailable history retains latest notes and signals a partial list', async () => {
  const result = await loadReleaseNotes(async () => { throw Error('HTTP 403'); }, release('1.2.3'), '1.2.1', '1.2.3');
  assert.equal(result.notesIncomplete, true);
  assert.deepEqual(result.releases.map(r => r.version), ['1.2.3']);
});

function updater(fetch) {
  const file = path.join(__dirname, '../src/main/updater.js');
  const realRequire = createRequire(file), events = [], module = { exports: {} };
  const requireFake = name => {
    if (name === 'electron') return { app: { getVersion: () => '1.2.1' }, net: { fetch } };
    if (name === './paths') return { dataRoot: () => { throw Error('Update checks must not write files'); } };
    if (name === './window-bus') return { send: (_channel, state) => events.push(state) };
    return realRequire(name);
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: requireFake, module, exports: module.exports, AbortSignal, setTimeout, process });
  return { api: module.exports, events };
}

test('real updater publishes all missed versions, clears stale results, and avoids unnecessary history requests', async () => {
  const calls = [];
  let mode = 'available';
  const { api } = updater(async url => {
    calls.push(url);
    if (mode === 'failure') throw Error('offline');
    return response(url.endsWith('/latest') ? release(mode === 'current' ? '1.2.1' : '1.2.3') : [release('1.2.3'), release('1.2.2'), release('1.2.1')]);
  });
  assert.equal(calls.length, 0);
  const state = await api.check();
  assert.equal(state.phase, 'available');
  assert.equal(state.current, '1.2.1');
  assert.equal(Array.from(state.releases, r => r.version).join(','), '1.2.3,1.2.2');
  mode = 'current'; calls.length = 0;
  const current = await api.check();
  assert.equal(current.phase, 'uptodate');
  assert.equal(current.releases.length, 0);
  assert.equal(calls.length, 1);
  mode = 'failure';
  const failure = await api.check();
  assert.equal(failure.phase, 'error');
  assert.equal(failure.releases.length, 0);
  assert.equal(failure.latest, null);
});

test('a notes failure does not turn an available update into an update error', async () => {
  const { api } = updater(async url => {
    if (!url.endsWith('/latest')) throw Error('rate limited');
    return response(release('1.2.3'));
  });
  const result = await api.check();
  assert.equal(result.phase, 'available');
  assert.equal(result.notesIncomplete, true);
  assert.equal(result.releases[0].version, '1.2.3');
});
