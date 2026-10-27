const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLandmarks } = require('../tools/build-map-landmarks');

test('overview selection uses notability, omits ordinary facilities and keeps original names intact', () => {
  const data = { landmarks: { count: 4, gid: [1, 2, 3, 4], lat: [1, 2, 3, 4], lng: [5, 6, 7, 8],
    en: ['Famous Monument', 'Small Monument', 'Central Railway Station', 'City Hospital'], zh: ['著名纪念碑', '', '', ''], rank: [60, 12, 70, 80] } };
  const original = JSON.stringify(data);
  const result = buildLandmarks(data);
  assert.equal(JSON.stringify(data), original);
  const originalFeatures = result.features.filter(f => typeof f.id === 'number');
  assert.equal(originalFeatures.length, 1);
  assert.equal(originalFeatures[0].properties.name, 'Famous Monument');
  assert.equal(originalFeatures[0].properties['name:zh-Hans'], '著名纪念碑');
  assert.deepEqual(originalFeatures[0].geometry.coordinates, [5, 1]);
});
