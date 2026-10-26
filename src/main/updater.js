/**
 * updater.js -- Settings > Updates > "Check for Updates".
 *
 * Only ever runs when the person asks (no check at launch, nothing in the background). It
 *   1. asks GitHub which release is the latest (https, this repository only),
 *   2. on "Update and Restart" downloads Photos-arm64.zip and its .sha256 into <data>/updates,
 *      verifies the checksum,
 *   3. quits the app and lets a small helper (safe-exec.js: spawnUpdateHelper) swap the app
 *      bundle for the new one and open it again.
 * Photos and library data are never involved: only the app bundle and <data>/updates change.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, net } = require('electron');
const paths = require('./paths');
const windowBus = require('./window-bus');
const { compareVersions } = require('./version-compare');

const REPO = 'zhengzihao2002/Photos';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_BASE = `https://github.com/${REPO}/releases/download/`;
const ZIP_NAME = 'Photos-arm64.zip';

const state = { phase: 'idle', current: null, latest: null, percent: 0, error: null };

function publish(patch) {
  Object.assign(state, patch);
  windowBus.send('updater:state', getState());
}
function getState() { return { ...state, current: app.getVersion() }; }

/** The app bundle this process runs from (.../Photos.app), or null when running from source. */
function appBundlePath() {
  if (!app.isPackaged) return null;
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

async function fetchOk(url, init) {
  const res = await net.fetch(url, { redirect: 'follow', ...init, headers: { 'User-Agent': 'Photos-updater', ...((init && init.headers) || {}) } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}

async function check() {
  if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing') return getState();
  publish({ phase: 'checking', error: null, percent: 0 });
  try {
    const res = await fetchOk(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } });
    const body = await res.json();
    const tag = typeof body.tag_name === 'string' ? body.tag_name : '';
    if (!/^v?\d+(\.\d+){1,3}$/.test(tag)) throw new Error('unexpected release tag');
    const latest = tag.replace(/^v/, '');
    publish({ phase: compareVersions(latest, app.getVersion()) > 0 ? 'available' : 'uptodate', latest });
  } catch (err) {
    publish({ phase: 'error', error: err && err.message ? err.message : String(err) });
  }
  return getState();
}

async function download(url, file, onPercent) {
  const res = await fetchOk(url);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  let got = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (total && onPercent) onPercent(Math.min(99, Math.floor((got / total) * 100)));
    }
    await new Promise((resolve, reject) => { out.once('error', reject); out.end(resolve); });
  } catch (err) {
    out.destroy();
    throw err;
  }
  return hash.digest('hex');
}

async function install() {
  if (state.phase === 'downloading' || state.phase === 'installing') return getState();
  const bundle = appBundlePath();
  if (!bundle) { publish({ phase: 'error', error: 'notPackaged' }); return getState(); }
  if (!state.latest) await check();
  if (state.phase !== 'available') return getState();
  const version = state.latest;
  publish({ phase: 'downloading', percent: 0, error: null });
  const workDir = path.join(paths.dataRoot(), 'updates');
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    const zip = path.join(workDir, ZIP_NAME);
    const base = DOWNLOAD_BASE + 'v' + version + '/';
    const [shaText, got] = await Promise.all([
      fetchOk(base + ZIP_NAME + '.sha256').then((r) => r.text()),
      download(base + ZIP_NAME, zip, (percent) => publish({ percent })),
    ]);
    const want = (shaText.trim().split(/\s+/)[0] || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want) || want !== got) throw new Error('checksum mismatch');
    publish({ phase: 'installing', percent: 100 });
    require('./safe-exec').spawnUpdateHelper({ pid: process.pid, appPath: bundle, zipPath: zip, workDir });
    setTimeout(() => app.quit(), 400);
    setTimeout(() => app.exit(0), 15000); // never leave the helper waiting on a stuck shutdown
  } catch (err) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    publish({ phase: 'error', error: err && err.message ? err.message : String(err) });
  }
  return getState();
}

module.exports = { check, install, getState, appBundlePath };
