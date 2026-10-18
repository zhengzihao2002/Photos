/**
 * worker-size.js (M8c.6) -- measures folder sizes off the main thread.
 *
 * workerData: { jobs: [{ key, paths: string[] }], freeSpacePath: string }
 * Posts:      { sizes: { [key]: bytes }, files: { [key]: count },
 *               freeBytes: number|null, ms: number }
 *
 * Sizes are allocated disk blocks (stat.blocks * 512), the same measure as
 * `du`, so the Storage view matches `du -sh`. Symlinks are not followed;
 * unreadable entries are skipped. Read-only: never writes anything.
 */
const { parentPort, workerData } = require('worker_threads');
require('../write-guard').installInWorker(workerData.guard); // M11: the first thing a worker does
const fs = require('fs');
const path = require('path');

function measure(p, acc) {
  let st;
  try { st = fs.lstatSync(p); } catch (e) { return; }
  acc.bytes += typeof st.blocks === 'number' ? st.blocks * 512 : st.size;
  if (st.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(p); } catch (e) { return; }
    for (const n of names) measure(path.join(p, n), acc);
  } else {
    acc.files += 1;
  }
}

const started = Date.now();
const sizes = {};
const files = {};
for (const job of (workerData && workerData.jobs) || []) {
  const acc = { bytes: 0, files: 0 };
  for (const p of job.paths || []) measure(p, acc);
  sizes[job.key] = acc.bytes;
  files[job.key] = acc.files;
}
let freeBytes = null;
try {
  const s = fs.statfsSync(workerData.freeSpacePath);
  freeBytes = s.bavail * s.bsize;
} catch (e) { /* unknown */ }
parentPort.postMessage({ sizes, files, freeBytes, ms: Date.now() - started });
