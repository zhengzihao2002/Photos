/**
 * square-layout.js (M6, B.6) -- Apple-style square grid.
 *
 * Same API as layout-engine.js (createLayoutEngine), so Grid can use either.
 * Pure math, no DOM. Rows are computed on demand by arithmetic (no stored
 * row list), so memory does not grow with library size.
 *
 * ORDER: data indices are newest-first (index 0 = newest). Visually the
 * grid runs OLDEST at top-left to NEWEST at the bottom. As in Apple Photos,
 * the bottom row is FULL at the column count the grid opened with (newest at
 * bottom-right); a zoom keeps that alignment, so at other zoom levels the
 * last row may be partial. Any leading empty slots are in the first row,
 * expressed as row.leadingOffset (px). Rows list data indices in visual order,
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
    const refCols = cols; // reference: the bottom row is full at this column count
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
      // Apple-style: the bottom row is full at the column count the grid
      // opened with (refCols). Zooming keeps that alignment, so at other zoom
      // levels the last row may be partial.
      const refLead = total % refCols === 0 ? 0 : refCols - (total % refCols);
      // alignTop (filtered views): fill from the top-left, no leading slots.
      lead = alignTop ? 0 : refLead % cols;
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
    };
  }

  window.createSquareLayout = createSquareLayout;
})();
