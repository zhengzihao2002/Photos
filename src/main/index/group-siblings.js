/**
 * group-siblings.js
 *
 * Pure grouping logic for files that share a directory: Live Photo pairing
 * (same basename, image + video) and burst detection (sequential capture
 * times under 1.5 seconds apart). Operates on already-extracted metadata
 * objects, not file paths — no I/O here at all.
 *
 * Both are the rule-based heuristics agreed on in M1.3: no AI, no content
 * analysis, just filename and timestamp comparison. Bursts in particular
 * are a heuristic, not an exact science — documented as a known limitation,
 * not treated as ground truth.
 *
 * Ordering matters: findLivePhotoPairs must run first, and its claimed
 * image indices must be excluded from findBursts. A Live Photo's image is
 * always its own distinct tile — sweeping it into a burst as a non-cover
 * member would make it vanish from every view entirely, since its video is
 * already hidden as a Live Photo component and a non-cover burst member is
 * also hidden. That's real data loss from the user's perspective, not a
 * display simplification.
 */

const path = require('path');

const BURST_WINDOW_SECONDS = 1.5;
const BURST_MIN_SIZE = 2;

function basenameWithoutExtension(filename) {
  const ext = path.extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

function captureTimeLocalToEpochSeconds(captureTimeLocal) {
  if (!captureTimeLocal) return null;
  const isoLike = captureTimeLocal.replace(' ', 'T');
  const date = new Date(isoLike);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time / 1000;
}

/**
 * Finds image+video pairs sharing a basename within one directory's worth
 * of already-extracted rows. Returns a Map from the image row's array index
 * to the paired video row's array index — the caller decides insert order
 * (video first, so its DB id exists before the image row references it).
 */
function findLivePhotoPairs(rows) {
  const videoIndexByBasename = new Map();
  rows.forEach((row, index) => {
    if (row.media_type === 'video') {
      const key = basenameWithoutExtension(row.filename).toLowerCase();
      videoIndexByBasename.set(key, index);
    }
  });

  const pairs = new Map();
  rows.forEach((row, index) => {
    if (row.media_type !== 'image') return;
    const key = basenameWithoutExtension(row.filename).toLowerCase();
    if (videoIndexByBasename.has(key)) {
      pairs.set(index, videoIndexByBasename.get(key));
    }
  });

  return pairs;
}

/**
 * Groups images into bursts: runs of 2+ photos less than
 * BURST_WINDOW_SECONDS apart, sorted by capture time. excludedIndices
 * (typically the keys of findLivePhotoPairs's result) are skipped entirely
 * — never merged into a burst as cover or non-cover member. Returns a Map
 * from array index to { burstId, isCover }.
 */
function findBursts(rows, sourceFolderId, excludedIndices = new Set()) {
  const imageIndices = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => row.media_type === 'image' && !excludedIndices.has(index))
    .map(({ row, index }) => ({
      index,
      epochSeconds: captureTimeLocalToEpochSeconds(row.capture_time_local),
    }))
    .filter(({ epochSeconds }) => epochSeconds !== null)
    .sort((a, b) => a.epochSeconds - b.epochSeconds);

  const result = new Map();
  let runStart = 0;

  for (let i = 1; i <= imageIndices.length; i += 1) {
    const withinWindow = i < imageIndices.length
      && imageIndices[i].epochSeconds - imageIndices[i - 1].epochSeconds <= BURST_WINDOW_SECONDS;

    if (withinWindow) continue;

    const runLength = i - runStart;
    if (runLength >= BURST_MIN_SIZE) {
      const burstId = `${sourceFolderId}:${Math.round(imageIndices[runStart].epochSeconds * 1000)}`;
      for (let j = runStart; j < i; j += 1) {
        result.set(imageIndices[j].index, { burstId, isCover: j === runStart });
      }
    }
    runStart = i;
  }

  return result;
}

module.exports = { findLivePhotoPairs, findBursts, basenameWithoutExtension };
