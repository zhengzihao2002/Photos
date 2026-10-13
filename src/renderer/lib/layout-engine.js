/**
 * layout-engine.js
 *
 * Pure math: computes the justified-grid row structure (per M3 spec's
 * Apple-Photos-style packing algorithm) from item aspect ratios, without
 * touching the DOM. Depends on window (no other vendor deps).
 *
 * DECISION (recorded for the M3 return handoff): layout is computed EAGERLY
 * and IN FULL (a single O(N) pass) rather than lazily/incrementally,
 * because the virtualizer (M3.4) requires the TOTAL scroll height up front
 * regardless — so a "lazy" approach still needs an O(N) pass just to answer
 * "how tall is the whole scroll area," which undercuts the complexity a
 * lazy approach would otherwise save. A full pass over 100k items is a
 * cheap linear scan of arithmetic (no DOM), on the order of a few ms.
 *
 * What IS avoided is recomputing on every scroll frame: full layout only
 * reruns on: (1) container resize, (2) zoom (target row height) change,
 * (3) explicit item-count/date-section changes (filter change, new data).
 *
 * PLACEHOLDER ASPECT RATIOS: items not yet loaded from the data layer use
 * a 4:3 fallback ratio for packing purposes (per M1's documented null-
 * dimension fallback). When real dimensions later arrive and differ from
 * the guess, notifyItemsResolved() triggers a TARGETED recompute starting
 * at the affected row — not a full-grid recompute — since only that row
 * and everything after it (heights cascade downward) can have shifted.
 */
(function () {
  const FALLBACK_ASPECT_RATIO = 4 / 3;

  function createLayoutEngine({ dataLayer, containerWidth, targetRowHeight, gapSize, headerRowHeight }) {
    let rows = [];             // flat list of { type, top, height, ... }
    let totalHeight = 0;
    const itemAspectRatioCache = new Map(); // itemIndex -> { ratio, isFallback }

    function getAspectRatio(itemIndex) {
      const item = dataLayer.getItemAt(itemIndex);
      if (item.__placeholder || !item.width || !item.height) {
        itemAspectRatioCache.set(itemIndex, { ratio: FALLBACK_ASPECT_RATIO, isFallback: true });
        return FALLBACK_ASPECT_RATIO;
      }
      const ratio = item.width / item.height;
      itemAspectRatioCache.set(itemIndex, { ratio, isFallback: false });
      return ratio;
    }

    /** Packs one row starting at startIndex, never crossing sectionEnd (exclusive). */
    function packRow(startIndex, sectionEnd) {
      const itemIndices = [];
      const ratios = [];
      let naturalWidth = 0; // sum of (ratio * targetRowHeight) plus inter-item gaps

      let i = startIndex;
      while (i < sectionEnd) {
        const ratio = getAspectRatio(i);
        const widthAtTarget = ratio * targetRowHeight;
        const count = itemIndices.length;
        const prospective = naturalWidth + widthAtTarget + (count > 0 ? gapSize : 0);
        if (count > 0 && prospective > containerWidth) break; // row is full; always keep >=1 item
        naturalWidth = prospective;
        itemIndices.push(i);
        ratios.push(ratio);
        i++;
      }

      const reachedSectionEnd = i >= sectionEnd;
      let height, itemWidths;
      if (reachedSectionEnd && naturalWidth < containerWidth) {
        // Last row of this date group: left-aligned, unscaled (per spec).
        height = targetRowHeight;
        itemWidths = ratios.map((r) => r * targetRowHeight);
      } else {
        const gapsWidth = (itemIndices.length - 1) * gapSize;
        const scale = (containerWidth - gapsWidth) / (naturalWidth - gapsWidth);
        height = targetRowHeight * scale;
        itemWidths = ratios.map((r) => r * targetRowHeight * scale);
      }

      return { itemIndices, itemWidths, height, nextIndex: i };
    }

    function findSectionIndex(sections, itemIndex) {
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (itemIndex >= s.startIndex && itemIndex < s.startIndex + s.count) return i;
      }
      return -1;
    }

    /**
     * Packs rows from fromItemIndex to the end of the dataset, appending to
     * keptRows (rows already known-correct from before fromItemIndex), and
     * writes the result into module state (rows, totalHeight). Used by both
     * a full recompute (keptRows = [], fromItemIndex = 0) and a targeted
     * partial recompute (keptRows = untouched prefix, fromItemIndex = the
     * first item whose row needs re-packing).
     */
    function layoutFrom(fromItemIndex, fromTop, keptRows) {
      rows = keptRows;
      let currentTop = fromTop;
      const totalCount = dataLayer.getTotalCount();
      const rawSections = dataLayer.getDateSections();
      const sections = rawSections.length ? rawSections : [{ date: null, count: totalCount, startIndex: 0 }];

      let sIdx = findSectionIndex(sections, fromItemIndex);
      if (sIdx === -1) sIdx = Math.max(0, sections.length - 1);

      let index = fromItemIndex;
      for (; sIdx < sections.length; sIdx++) {
        const section = sections[sIdx];
        const sectionEnd = section.startIndex + section.count;
        if (index < section.startIndex) index = section.startIndex;

        // Only emit a header when resuming exactly at this section's start —
        // otherwise its header was already emitted into a row we kept.
        if (section.date !== null && index === section.startIndex) {
          rows.push({ type: 'header', date: section.date, top: currentTop, height: headerRowHeight });
          currentTop += headerRowHeight + gapSize;
        }

        while (index < sectionEnd) {
          const packed = packRow(index, sectionEnd);
          rows.push({
            type: 'items',
            itemIndices: packed.itemIndices,
            itemWidths: packed.itemWidths,
            top: currentTop,
            height: packed.height,
          });
          currentTop += packed.height + gapSize;
          index = packed.nextIndex;
        }
      }

      if (rows.length) currentTop -= gapSize; // undo trailing gap after the very last row
      totalHeight = Math.max(0, currentTop);
    }

    function computeLayout() {
      itemAspectRatioCache.clear();
      const totalCount = dataLayer.getTotalCount();
      if (totalCount == null || totalCount === 0) {
        rows = [];
        totalHeight = 0;
        return;
      }
      layoutFrom(0, 0, []);
    }

    /**
     * Call when the data layer reports newly-loaded items (via its
     * onRangeLoaded callback). If any of them were laid out using the 4:3
     * fallback and now have a real, different aspect ratio, re-packs from
     * the earliest affected row onward only — not the whole grid.
     */
    function notifyItemsResolved(indices) {
      if (!rows.length) return;

      let earliestChanged = null;
      for (const idx of indices) {
        const cached = itemAspectRatioCache.get(idx);
        if (!cached || !cached.isFallback) continue;
        const item = dataLayer.getItemAt(idx);
        if (item.__placeholder || !item.width || !item.height) continue;
        const realRatio = item.width / item.height;
        if (Math.abs(realRatio - cached.ratio) < 0.001) continue;
        if (earliestChanged === null || idx < earliestChanged) earliestChanged = idx;
      }
      if (earliestChanged === null) return;

      let rowIdx = rows.findIndex((r) => r.type === 'items' && r.itemIndices.includes(earliestChanged));
      if (rowIdx === -1) return;

      // If the row just before is this section's header, leave it out of keptRows
      // so layoutFrom() re-emits it exactly once (otherwise it would duplicate).
      const headerBefore = rowIdx > 0 && rows[rowIdx - 1].type === 'header';
      const keptRows = rows.slice(0, headerBefore ? rowIdx - 1 : rowIdx);
      const prev = keptRows[keptRows.length - 1];
      const resumeTop = prev ? prev.top + prev.height + gapSize : 0;
      const resumeIndex = rows[rowIdx].itemIndices[0];

      layoutFrom(resumeIndex, resumeTop, keptRows);
    }

    function getTotalHeight() {
      return totalHeight;
    }

    function getRowAt(rowIndex) {
      return rows[rowIndex] || null;
    }

    function getRowCount() {
      return rows.length;
    }

    /** Linear scan for the row index containing a given item index. -1 if not found (rare: resize anchor lookup only, not a hot path). */
    function getRowIndexForItem(itemIndex) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.type === 'items' && row.itemIndices.includes(itemIndex)) return i;
      }
      return -1;
    }

    /** Binary search: which row index contains scrollTop. Rows are sorted by top ascending. */
    function findRowContainingOffset(scrollTop) {
      if (!rows.length) return -1;
      let lo = 0, hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].top + rows[mid].height <= scrollTop) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    function setContainerWidth(width) {
      containerWidth = width;
      computeLayout();
    }

    function setTargetRowHeight(height) {
      targetRowHeight = height;
      computeLayout();
    }

    computeLayout();

    return {
      computeLayout,
      getTotalHeight,
      getRowAt,
      getRowCount,
      getRowIndexForItem,
      findRowContainingOffset,
      notifyItemsResolved,
      setContainerWidth,
      setTargetRowHeight,
    };
  }

  window.createLayoutEngine = createLayoutEngine;
})();
