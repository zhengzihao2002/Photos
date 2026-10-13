/**
 * queue-core.js
 *
 * Pure scheduling logic for thumbnail generation: two lanes, a concurrency
 * cap, and the bookkeeping around failures. No database, filesystem, timers
 * or Electron, so it runs anywhere and can be tested in plain Node.
 * Everything external is injected:
 *
 *   fetchBackground(afterId, limit, excludedFolderIds) -> jobs, ascending id
 *   claim(job)   -> true if this job may run (false = someone else has it)
 *   process(job) -> { ok: true } or { ok: false, code, message }
 *   onResult(job, result), onIdle(), onPause(reason), onError(err)
 *
 * A job is { id, folderId, sizes: ['sm'] | ['md'] | ['sm','md'], ...payload }.
 *
 * Lanes: the foreground list is REPLACED by every setForeground() call and
 * always drains before background work. The background lane pages through
 * fetchBackground with an ascending id cursor; wake() restarts that cursor
 * once it is exhausted, which is how retries and new items get picked up.
 *
 * Failures: environment codes (source_missing, permission_denied,
 * read_failed) block that id for the rest of the session. Five write_failed
 * results in a row pause the queue (the owner decides when to resume).
 * Folders can be set aside so their jobs are dropped until restored. A
 * throwing job or callback never stops the queue.
 */

const ENVIRONMENT_CODES = new Set(['source_missing', 'permission_denied', 'read_failed']);

function createQueue(options) {
  const {
    concurrency = 3,
    fetchBackground,
    claim,
    process: processJob,
    onResult = () => {},
    onIdle = () => {},
    onPause = () => {},
    onError = () => {},
    backgroundBatchSize = 200,
    pauseAfterWriteFailures = 5,
  } = options;

  const fg = [];
  const bg = { buffer: [], cursor: 0, exhausted: false, fetching: false };
  const running = new Set();
  const blockedIds = new Set();
  const setAside = new Set();
  const counts = { ok: 0, failed: 0, skipped: 0, environment: 0 };
  let paused = false;
  let stopped = false;
  let idleNotified = false;
  let writeFailStreak = 0;
  let drainWaiters = [];

  const isBlocked = (job) => blockedIds.has(job.id) || setAside.has(job.folderId);
  const safely = (fn, ...args) => {
    try { fn(...args); } catch (err) { try { onError(err); } catch (e) { /* ignore */ } }
  };

  function nextJob() {
    for (let i = 0; i < fg.length; i++) {
      if (isBlocked(fg[i])) { fg.splice(i--, 1); continue; }
      if (!running.has(fg[i].id)) return fg.splice(i, 1)[0];
    }
    while (bg.buffer.length) {
      const job = bg.buffer.shift();
      if (!isBlocked(job) && !running.has(job.id)) return job;
    }
    return null;
  }

  async function refill() {
    bg.fetching = true;
    try {
      const rows = await fetchBackground(bg.cursor, backgroundBatchSize, [...setAside]);
      if (!rows || rows.length === 0) {
        bg.exhausted = true;
      } else {
        bg.cursor = rows[rows.length - 1].id;
        bg.buffer.push(...rows);
        idleNotified = false;
      }
    } catch (err) {
      bg.exhausted = true;
      safely(onError, err);
    }
    bg.fetching = false;
    pump();
  }

  function checkIdle() {
    if (idleNotified || running.size || fg.length || bg.buffer.length) return;
    if (!bg.exhausted || bg.fetching) return;
    idleNotified = true;
    safely(onIdle);
  }

  function pump() {
    if (stopped || paused) return;
    while (running.size < concurrency) {
      const job = nextJob();
      if (!job) break;
      start(job);
    }
    if (running.size < concurrency && !bg.buffer.length && !bg.exhausted && !bg.fetching) refill();
    checkIdle();
  }

  function start(job) {
    running.add(job.id);
    idleNotified = false;
    (async () => {
      let result;
      try {
        result = (await claim(job)) ? await processJob(job) : { skipped: true };
      } catch (err) {
        result = { ok: false, code: 'exception', message: String((err && err.message) || err) };
      }
      running.delete(job.id);
      finish(job, result);
      pump();
    })();
  }

  function finish(job, result) {
    if (result.skipped) {
      counts.skipped++;
    } else {
      if (result.ok) counts.ok++;
      else if (ENVIRONMENT_CODES.has(result.code)) { blockedIds.add(job.id); counts.environment++; }
      else counts.failed++;
      writeFailStreak = !result.ok && result.code === 'write_failed' ? writeFailStreak + 1 : 0;
      safely(onResult, job, result);
      if (writeFailStreak >= pauseAfterWriteFailures) pause('write_failed');
    }
    if (running.size === 0 && drainWaiters.length) {
      drainWaiters.forEach((resolve) => resolve());
      drainWaiters = [];
    }
  }

  function setForeground(jobs) {
    const seen = new Set();
    fg.length = 0;
    for (const job of jobs) {
      const key = job.id + ':' + job.sizes.join(',');
      if (seen.has(key) || isBlocked(job)) continue;
      seen.add(key);
      fg.push(job);
    }
    if (fg.length) idleNotified = false;
    pump();
  }

  function wake() {
    if (stopped) return;
    if (bg.exhausted && !bg.fetching && !bg.buffer.length) { bg.exhausted = false; bg.cursor = 0; }
    pump();
  }

  function pause(reason) { if (!paused) { paused = true; safely(onPause, reason); } }
  function resume() { if (paused) { paused = false; writeFailStreak = 0; pump(); } }
  function stop() {
    stopped = true;
    return running.size === 0 ? Promise.resolve() : new Promise((resolve) => drainWaiters.push(resolve));
  }

  function purge() {
    for (let i = fg.length - 1; i >= 0; i--) if (isBlocked(fg[i])) fg.splice(i, 1);
    bg.buffer = bg.buffer.filter((job) => !isBlocked(job));
  }
  function setAsideFolder(folderId) { setAside.add(folderId); purge(); }
  function restoreFolder(folderId) { setAside.delete(folderId); wake(); }
  function unblock(id) { blockedIds.delete(id); }

  function stats() {
    return {
      running: running.size, foreground: fg.length, buffered: bg.buffer.length,
      exhausted: bg.exhausted, paused, blockedIds: blockedIds.size, ...counts,
    };
  }

  return { wake, setForeground, pause, resume, stop, setAsideFolder, restoreFolder, unblock, stats };
}

module.exports = { createQueue, ENVIRONMENT_CODES };
