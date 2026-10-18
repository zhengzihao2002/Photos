/**
 * smoke.js  (M8d / M11) -- scripted self-test of the running app, for CI.
 *
 * INACTIVE unless the environment variable PHOTOS_SMOKE names a folder (a generated test
 * library made by tools/make-fixtures.js). It is not reachable from the UI, takes no input
 * from a page, never runs in a normal launch, and obeys every promise of the app: it adds the
 * folder as an ordinary read-only source and uses the same code paths as the user would. The
 * only extra writes are the JSON report and the data folder named by PHOTOS_SMOKE_DATA.
 *
 *   PHOTOS_SMOKE=<library folder>   PHOTOS_SMOKE_REPORT=<report.json>   PHOTOS_SMOKE_DATA=<data folder>
 *
 * Steps (each recorded as pass / fail): window loads with no console errors, source added,
 * scan counts match the generator's manifest, thumbnails made, a preview rendered, a video
 * converted, landmarks found, face worker ran, edits (favorite, title, keywords, rotate, undo),
 * search, Storage sizes, language switch to Chinese and back, write-guard negative controls.
 * Exit code 0 only when every step passed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, Menu } = require('electron');

const enabled = () => typeof process.env.PHOTOS_SMOKE === 'string' && process.env.PHOTOS_SMOKE !== '';
let exitCode = 0;
const report = { startedAt: new Date().toISOString(), platform: process.platform + '/' + process.arch, steps: [], consoleErrors: [], timings: {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out after ' + timeoutMs + ' ms waiting for ' + label);
    await sleep(500);
  }
}

async function run(getWindow) {
  const folder = process.env.PHOTOS_SMOKE;
  const readOnlyMedia = process.env.PHOTOS_SMOKE_READONLY === '1';
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, '.fixture-manifest.json'), 'utf8'));
  const db = require('./index/db');
  const Q = require('./index/queries');
  const win = getWindow();
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  wc.on('console-message', (...args) => {
    const d = args[0] && typeof args[0] === 'object' && 'level' in args[0] ? args[0] : { level: args[1], message: args[2] };
    const level = d.level; // 'error' | 3
    if (level === 'error' || level === 3) report.consoleErrors.push(String(d.message).slice(0, 300));
  });

  const out = process.env.PHOTOS_SMOKE_REPORT;
  if (out) require('./write-guard').allow(path.dirname(out)); // the report file: the one write this test makes outside the data folder
  const save = () => { if (out) { try { fs.writeFileSync(out, JSON.stringify(report, null, 2)); } catch (e) { /* reported at the end */ } } };
  // Watchdog: a hung step must not hang CI. Writes what it has and exits non-zero.
  const watchdog = setTimeout(() => {
    report.timedOut = true; report.ok = false; save();
    console.error('SMOKE_TIMEOUT after the steps: ' + report.steps.map((x) => x.name).join(' | '));
    app.exit(1);
  }, Number(process.env.PHOTOS_SMOKE_TIMEOUT_MS || 560000));

  async function step(name, fn) {
    const t0 = Date.now();
    try {
      const detail = await fn();
      report.steps.push({ name, ok: true, ms: Date.now() - t0, detail: detail === undefined ? null : detail });
    } catch (err) {
      report.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(err && err.stack ? err.stack : err).slice(0, 800) });
    }
    save();
    const last = report.steps[report.steps.length - 1];
    console.log('SMOKE_STEP ' + (last.ok ? 'PASS ' : 'FAIL ') + name + ' (' + (Date.now() - t0) + ' ms)' + (last.ok ? '' : ' :: ' + String(last.error).split('\n')[0]));
  }

  await step('main window loads the app scripts', async () => {
    await waitFor(async () => (await js('document.readyState')) === 'complete', 30000, 'page load');
    const info = await js('({ t: typeof window.t, i18n: typeof window.i18n, lang: document.documentElement.lang, title: document.title, api: typeof window.api, preact: typeof window.preact, place: typeof window.PlaceText })');
    if (info.t !== 'function' || info.i18n !== 'object' || info.api !== 'object' || info.preact !== 'object' || info.place !== 'object') throw new Error('missing globals: ' + JSON.stringify(info));
    return info;
  });

  const sources = require('./index/source-folders');
  const scanQueue = require('./index/scan-queue');
  await step('add the library folder as a source and scan it', async () => {
    const paths = require('./paths');
    const r = await sources.addSourceFolder(db.get(), folder, { protectedRoots: paths.protectedRoots() });
    if (!r.added) throw new Error('not added: ' + r.reason);
    require('./index/source-guard').sync();
    require('./index/folder-watcher').refresh();
    scanQueue.enqueue({ sourceFolderId: r.id, sourceRootPath: folder });
    await waitFor(() => { const s = scanQueue.getState(); return !s.running && s.pending.length === 0 && Q.getTotalCount(db.get()) > 0; }, 180000, 'the scan');
    return { sourceFolderId: r.id };
  });

  await step('counts match the generated manifest', async () => {
    const c = Q.getPhotoVideoCounts(db.get(), { filter: null });
    if (c.photos !== manifest.photos || c.videos !== manifest.videos) {
      const rows = db.get().prepare('SELECT extension, media_type, is_deleted, is_live_photo_component AS comp, COUNT(*) AS n FROM items GROUP BY 1,2,3,4').all();
      const have = new Set(db.get().prepare('SELECT filename FROM items').all().map((r) => r.filename));
      const missing = manifest.files.map((f) => path.basename(f)).filter((f) => !have.has(f));
      throw new Error('expected ' + manifest.photos + '/' + manifest.videos + ' got ' + c.photos + '/' + c.videos + ' | by type: ' + JSON.stringify(rows) + ' | missing: ' + missing.slice(0, 8).join(','));
    }
    const per = Q.getPhotoVideoCounts(db.get(), { filter: 'source:1' });
    if (per.photos !== c.photos || per.videos !== c.videos) throw new Error('per-source counts differ from the total');
    return c;
  });

  await step('thumbnails are made for every item', async () => {
    try {
      await waitFor(() => db.get().prepare("SELECT COUNT(*) AS n FROM items WHERE is_deleted = 0 AND (thumb_sm_status IS NULL OR thumb_sm_status = 'pending')").get().n === 0, 120000, 'thumbnails');
    } catch (e) {
      const rows = db.get().prepare("SELECT extension, thumb_sm_status AS s, COUNT(*) AS n FROM items WHERE is_deleted = 0 GROUP BY 1,2").all();
      throw new Error(e.message + ' | ' + JSON.stringify(rows));
    }
    const bad = db.get().prepare("SELECT filename FROM items WHERE thumb_sm_status = 'error'").all().map((r) => r.filename);
    if (bad.length) throw new Error('thumbnail errors: ' + bad.join(', '));
    return { done: db.get().prepare("SELECT COUNT(*) AS n FROM items WHERE thumb_sm_status = 'done'").get().n };
  });

  await step('the grid shows tiles with thumbnails (no file paths in the page)', async () => {
    const n = await waitFor(async () => { const k = await js("document.querySelectorAll('img.tile-img').length"); return k > 0 ? k : false; }, 60000, 'tiles');
    const srcs = await js("Array.from(document.querySelectorAll('img.tile-img')).slice(0, 5).map((i) => i.src)");
    if (!srcs.every((s) => s.startsWith('photos-media://thumb/'))) throw new Error('unexpected thumbnail URLs: ' + srcs.join(' '));
    const loaded = await waitFor(async () => (await js("Array.from(document.querySelectorAll('img.tile-img')).filter((i) => i.complete && i.naturalWidth > 0).length")) > 0, 30000, 'a decoded thumbnail');
    return { tiles: n, decoded: loaded };
  });

  await step('a preview renders for a format the browser cannot show', async () => {
    const row = db.get().prepare("SELECT id, filename FROM items WHERE extension IN ('tiff','tif','bmp','heic') ORDER BY (extension = 'tiff') DESC LIMIT 1").get();
    if (!row) return 'no such fixture';
    const svc = require('./display/display-service');
    const res = await svc.ensureDisplay(row.id);
    if (!res || res.ok === false) throw new Error('ensureDisplay failed for ' + row.filename + ': ' + JSON.stringify(res));
    const src = await svc.getDisplaySource(row.id);
    if (!src.ok || !src.url) throw new Error('no display url: ' + JSON.stringify(src));
    return { file: row.filename, url: src.url };
  });

  await step('a video that needs converting is converted and plays from a cache', async () => {
    if (!manifest.convertVideo) return 'no video fixture';
    const row = db.get().prepare('SELECT id FROM items WHERE filename = ?').get(path.basename(manifest.convertVideo));
    const svc = require('./display/display-service');
    const res = await svc.ensureDisplay(row.id);
    if (!res || res.ok === false) throw new Error('conversion failed: ' + JSON.stringify(res));
    const src = await svc.getDisplaySource(row.id);
    if (!src.url) throw new Error('no url after conversion: ' + JSON.stringify(src));
    return { url: src.url };
  });

  await step('landmarks are found offline and shown in the title priority order', async () => {
    const out = {};
    for (const [file, name] of Object.entries(manifest.landmarks || {})) {
      const row = db.get().prepare('SELECT id, place_landmark_en, place_locality_en FROM items WHERE filename = ?').get(file);
      if (!row || row.place_landmark_en !== name) throw new Error(file + ': expected ' + name + ', got ' + (row && row.place_landmark_en));
      out[file] = row.place_landmark_en + ' / ' + row.place_locality_en;
    }
    return out;
  });

  await step('the face worker loads its models and processes the images', async () => {
    const todo = () => db.get().prepare("SELECT COUNT(*) AS n FROM items WHERE media_type = 'image' AND is_deleted = 0 AND face_version IS NULL").get().n;
    try { await waitFor(() => todo() === 0, 90000, 'face analysis'); } catch (e) {
      throw new Error(e.message + ' | todo=' + todo() + ' status=' + JSON.stringify(require('./faces/face-manager').getStatus()));
    }
    return { faces: db.get().prepare('SELECT COUNT(*) AS n FROM faces').get().n };
  });

  await step('edits: favorite, title, keywords, rotate, undo and redo (database only)', async () => {
    const ed = require('./index/edits'); const tx = require('./index/edits-text'); const rot = require('./index/edits-rotate'); const hist = require('./index/edit-history');
    const row = db.get().prepare("SELECT id FROM items WHERE filename = 'IMG_0000.jpg'").get();
    const target = { ids: [row.id] };
    hist.recorded(db.get(), target, () => ed.setFavorite(db.get(), { target, value: true }));
    hist.recorded(db.get(), target, () => tx.setTitle(db.get(), { target, value: 'Smoke title' }));
    hist.recorded(db.get(), target, () => tx.updateKeywords(db.get(), { target, add: ['smoke'] }));
    hist.recorded(db.get(), target, () => rot.rotateItems(db.get(), { target, delta: 90 }));
    let it = Q.getItemById(db.get(), row.id);
    if (it.is_favorite !== 1 || it.title !== 'Smoke title' || !it.keywords.includes('smoke') || it.rotation !== 90) throw new Error('edit not applied');
    hist.undo(db.get());
    if (Q.getItemById(db.get(), row.id).rotation !== 0) throw new Error('undo did not restore rotation');
    hist.redo(db.get());
    const hit = Q.getItemsPage(db.get(), { limit: 10, filter: '::search:smoke' });
    if (!hit.items.some((x) => x.id === row.id)) throw new Error('search did not find the edited item');
    return 'ok';
  });

  await step('Storage sizes and clearing the preview cache', async () => {
    const storage = require('./storage/storage');
    const s = await storage.getSizes({ force: true });
    if (!(s.total > 0) || !Array.isArray(s.rows)) throw new Error('bad sizes');
    await require('./display/display-cache').clearAll();
    return { totalBytes: s.total };
  });

  await step('language switch: Chinese menu bar and page, then back to English', async () => {
    const i18n = require('./i18n');
    const loaded = () => new Promise((resolve) => wc.once('did-finish-load', resolve));
    let p = loaded(); i18n.setLanguage('zh-Hans'); await p;
    await waitFor(async () => (await js("typeof window.t === 'function' && document.documentElement.lang")) === 'zh-Hans', 20000, 'Chinese page');
    const labels = Menu.getApplicationMenu().items.map((m) => m.label).join('|');
    if (!/[一-鿿]/.test(labels) || /File|Edit|View/.test(labels)) throw new Error('menu bar not Chinese: ' + labels);
    await waitFor(async () => /[一-鿿]/.test(await js("(document.querySelector('.sb-label') || {}).textContent || ''")), 20000, 'Chinese sidebar');
    const sidebar = await js("Array.from(document.querySelectorAll('.sb-label')).map((e) => e.textContent).join(',')");
    p = loaded(); i18n.setLanguage('en'); await p;
    await waitFor(async () => (await js('document.documentElement.lang')) === 'en', 20000, 'English page');
    return { menuBar: labels, sidebar };
  });

  await step('write guard: writes into the library folder and outside the data folder are refused', async () => {
    const guard = require('./write-guard');
    const before = guard.getViolations().length;
    const attempts = [
      () => fs.writeFileSync(path.join(folder, 'GUARD-TEST.txt'), 'x'),
      () => fs.unlinkSync(path.join(folder, 'IMG_0000.jpg')),
      () => fs.mkdirSync(path.join(folder, 'GUARD-DIR')),
      () => fs.renameSync(path.join(folder, 'IMG_0000.jpg'), path.join(folder, 'renamed.jpg')),
      () => fs.writeFileSync(path.join(os.homedir(), 'photos-guard-test.txt'), 'x'),
    ];
    for (const a of attempts) {
      let refused = false;
      try { a(); } catch (e) { refused = e.code === guard.CODE; }
      if (!refused) throw new Error('a write was NOT refused: ' + a.toString());
    }
    const safe = require('./safe-exec');
    let blocked = false;
    try { safe.validate('/usr/bin/sips', ['-r', '90', path.join(folder, 'IMG_0000.jpg')]); } catch (e) { blocked = true; }
    if (!blocked) throw new Error('sips in-place edit was not refused');
    if (guard.getViolations().length - before !== attempts.length) throw new Error('violation count mismatch');
    return { refused: attempts.length + 1 };
  });

  await step('no unexpected write-guard violations during the whole run', async () => {
    const v = require('./write-guard').getViolations().filter((x) => !/GUARD-TEST|GUARD-DIR|IMG_0000.jpg|renamed.jpg|photos-guard-test/.test(x.target));
    if (v.length) throw new Error(JSON.stringify(v.slice(0, 5)));
    return 'none';
  });

  await step('no console errors in the page', async () => {
    if (report.consoleErrors.length) throw new Error(report.consoleErrors.slice(0, 5).join(' | '));
    return 'none';
  });

  report.finishedAt = new Date().toISOString();
  report.ok = report.steps.every((s) => s.ok);
  report.readOnlyMedia = readOnlyMedia;
  exitCode = report.ok ? 0 : 1;
  clearTimeout(watchdog);
  save();
  console.log('SMOKE_RESULT ' + JSON.stringify({ ok: report.ok, steps: report.steps.map((s) => (s.ok ? 'PASS ' : 'FAIL ') + s.name + (s.ok ? '' : ' :: ' + s.error.split('\n')[0])) }, null, 1));
  app.quit();
}

module.exports = { enabled, run, exitCode: () => exitCode, fail: (err) => { exitCode = 1; console.error('SMOKE_FATAL', err && err.stack ? err.stack : err); app.quit(); } };
