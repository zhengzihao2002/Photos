/**
 * edits-rotate.js -- M12.11
 *
 * Database-only rotation (never any write to a photo file or thumbnail).
 * rotation is clockwise degrees: 0, 90, 180 or 270, applied when drawing.
 * Each target item turns from its own current value, in one transaction.
 */

const { targetWhere } = require('./edits');

const ALLOWED = new Set([90, -90, 180]);

function rotateItems(db, { target, delta }) {
  if (!ALLOWED.has(delta)) throw new Error('Invalid rotation');
  const where = targetWhere(target);
  const run = db.transaction(() => db.prepare(
    'UPDATE items SET rotation = ((rotation + @d) % 360 + 360) % 360 WHERE id IN (SELECT id FROM items WHERE ' + where + ')'
  ).run({ d: delta }));
  return { changed: run().changes };
}

module.exports = { rotateItems };
