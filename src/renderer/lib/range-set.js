/**
 * range-set.js
 *
 * Tracks a set of non-overlapping, inclusive integer ranges (index ranges
 * of a virtualized list that have already been fetched and cached). Used
 * by data-layer.js to compute which parts of a requested [start, end]
 * window are already loaded versus still need fetching.
 *
 * All ranges are inclusive: [3, 7] covers indices 3,4,5,6,7. Ranges are
 * kept sorted and merged (adjacent/overlapping ranges combined) after
 * every insertion, so gap computation is a single linear scan.
 */
(function () {
  class RangeSet {
    constructor() {
      this._ranges = []; // sorted, non-overlapping, non-adjacent [start, end] pairs
    }

    /** Mark [start, end] (inclusive) as loaded. Merges with touching/overlapping neighbors. */
    addRange(start, end) {
      if (end < start) return;
      const merged = [];
      let inserted = false;
      for (const [s, e] of this._ranges) {
        if (e < start - 1) {
          merged.push([s, e]);
        } else if (s > end + 1) {
          if (!inserted) {
            merged.push([start, end]);
            inserted = true;
          }
          merged.push([s, e]);
        } else {
          start = Math.min(start, s);
          end = Math.max(end, e);
        }
      }
      if (!inserted) merged.push([start, end]);
      this._ranges = merged;
    }

    /** True if every index in [start, end] is already covered. */
    isFullyCovered(start, end) {
      return this.findGaps(start, end).length === 0;
    }

    /**
     * Returns the sub-ranges of [start, end] NOT yet covered, ascending order.
     * Empty array means the whole window is already loaded.
     */
    findGaps(start, end) {
      const gaps = [];
      let cursor = start;
      for (const [s, e] of this._ranges) {
        if (e < cursor) continue;
        if (s > end) break;
        if (s > cursor) gaps.push([cursor, Math.min(s - 1, end)]);
        cursor = Math.max(cursor, e + 1);
        if (cursor > end) break;
      }
      if (cursor <= end) gaps.push([cursor, end]);
      return gaps;
    }

    /** Drops any covered index outside [keepStart, keepEnd]. Used for cache eviction. */
    evictOutside(keepStart, keepEnd) {
      const kept = [];
      for (const [s, e] of this._ranges) {
        const clippedS = Math.max(s, keepStart);
        const clippedE = Math.min(e, keepEnd);
        if (clippedS <= clippedE) kept.push([clippedS, clippedE]);
      }
      this._ranges = kept;
    }

    clear() {
      this._ranges = [];
    }
  }

  window.RangeSet = RangeSet;
})();
