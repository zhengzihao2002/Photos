const test = require('node:test');
const assert = require('node:assert');
const { buildSelectionClause } = require('../src/main/index/selection-sql');

const tok = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('valid tokens produce SQL', () => {
  for (const o of [{ a: 1 }, { i: [1, 2, 3] }, { a: 1, x: [5] }, { r: [['2020-01-01 00:00:00', 1, '2020-02-01 00:00:00', 9]] }]) {
    assert.strictEqual(typeof buildSelectionClause(tok(o)), 'string');
  }
});

test('invalid tokens throw', () => {
  const bad = ['', 'a b', '!!!', tok({ z: 1 }), tok({ a: 2 }), tok({ i: ['1; DROP'] }), tok({ i: [0] }), tok({ i: [-4] }),
    tok({ r: [["2020-01-01' OR 1=1 --", 1, '2020-01-01 00:00:00', 2]] }), tok({ i: Array.from({ length: 50001 }, (_, k) => k + 1) }), tok([1]), 'x'.repeat(2000001)];
  for (const t of bad) assert.throws(() => buildSelectionClause(t), t.slice(0, 20));
});
