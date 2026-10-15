/**
 * square-layout.js (M6, B.6) -- Apple-style square grid.
 *
 * Same API as layout-engine.js (createLayoutEngine), so Grid can use either.
 * Pure math, no DOM. Rows are computed on demand by arithmetic (no stored
 * row list), so memory does not grow with library size.
 *
 * ORDER: data indices are newest-first (index 0 = newest). Visually the
 * grid runs OLDEST at top-left to NEWEST at the bottom.
 *
 * ALIGNMENT (M8c.3, U5): as in Apple Photos, both ends of a long grid look
 * full. Bottom-aligned, the last row is full (newest at bottom-right) and any
 * empty slots lead the first row; top-aligned, the first row is full (oldest
 * at top-left) and the last row may be short. Both give the SAME row count
 * and height, so the Grid switches alignment by scroll position (top half:
 * top, bottom half: bottom) while scrolling, without moving the scroll
 * position. Leading slots are row.leadingOffset (px). Rows list data indices in visual order,
 * so everything downstream (fetching, thumbnails, selection) keeps speaking
 * data indices unchanged.
 *
 * Tiles are square: size = floor((width - gaps) / columns). Changing the
 * container width scales tiles without moving them between rows.
 */
(function () {
  const MIN_COLUMNS = 1;
  const MAX_COLUMNS = 30;

  function createSquareLayout({ dataLayer, containerWidth, columns, gapSize, alignTop = false }) {
    let width = Math.max(0, containerWidth || 0);
    let cols = clampColumns(columns);
    let topAligned = !!alignTop; // M8c.3 (U5): switched by the Grid while scrolling
    const gap = gapSize || 0;
    let total = 0;
    let tile = 1;
    let lead = 0;      // empty slots before the oldest item (first row only)
    let rowCount = 0;
    let rowCache = new Map();

    function clampColumns(c) {
      const n = Math.round(Number(c)) || MIN_COLUMNS;
      return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, n));
    }

    function computeLayout() {
      total = Math.max(0, dataLayer.getTotalCount() || 0);
      tile = Math.max(1, Math.floor((width - (cols - 1) * gap) / cols));
      // Bottom-aligned: the last row is full at the CURRENT column count, so it
      // stays full at every zoom level; the leftover slots lead the first row.
      // Top-aligned: the first row is full, no leading slots.
      lead = topAligned || total % cols === 0 ? 0 : cols - (total % cols);
      rowCount = total === 0 ? 0 : Math.ceil((total + lead) / cols);
      rowCache = new Map();
    }

    const stride = () => tile + gap;

    function getRowAt(rowIndex) {
      if (rowIndex < 0 || rowIndex >= rowCount) return null;
      const cached = rowCache.get(rowIndex);
      if (cached) return cached;
      const firstSlot = rowIndex * cols;
      const startSlot = Math.max(firstSlot, lead);
      const endSlot = Math.min(firstSlot + cols, total + lead);
      const itemIndices = [];
      for (let slot = startSlot; slot < endSlot; slot++) {
        itemIndices.push(total - 1 - (slot - lead)); // visual position -> data index
      }
      const row = {
        type: 'items',
        itemIndices,
        itemWidths: itemIndices.map(() => tile),
        top: rowIndex * stride(),
        height: tile,
        leadingOffset: (startSlot - firstSlot) * stride(),
      };
      rowCache.set(rowIndex, row);
      return row;
    }

    function getTotalHeight() {
      return rowCount === 0 ? 0 : rowCount * stride() - gap;
    }

    function getRowCount() {
      return rowCount;
    }

    function getRowIndexForItem(itemIndex) {
      if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= total) return -1;
      const visual = total - 1 - itemIndex;
      return Math.floor((visual + lead) / cols);
    }

    /** Row containing scrollTop; a pixel in the gap below a row belongs to the next row. */
    function findRowContainingOffset(scrollTop) {
      if (rowCount === 0) return -1;
      const y = Math.max(0, scrollTop);
      let r = Math.floor(y / stride());
      if (y - r * stride() >= tile) r += 1;
      return Math.max(0, Math.min(rowCount - 1, r));
    }

    function notifyItemsResolved() { /* squares never depend on image shape */ }

    function setContainerWidth(w) { width = Math.max(0, w || 0); computeLayout(); }
    function setTargetRowHeight() { /* accepted for API parity; columns drive size */ }
    function setColumns(c) { cols = clampColumns(c); computeLayout(); }
    function getColumns() { return cols; }
    function getTileSize() { return tile; }
    /** Returns true when the alignment changed (rows were recomputed). */
    function setAlignTop(v) { const t = !!v; if (t === topAligned) return false; topAligned = t; computeLayout(); return true; }
    function getAlignTop() { return topAligned; }

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
      setColumns,
      getColumns,
      getTileSize,
      setAlignTop,
      getAlignTop,
    };
  }

  window.createSquareLayout = createSquareLayout;
})();
