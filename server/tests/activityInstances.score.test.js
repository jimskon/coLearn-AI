const test = require('node:test');
const assert = require('node:assert/strict');

const { parseScoreSpec } = require('../activity_instances/controller');

test('parseScoreSpec treats choice as a response-band alias', () => {
  assert.deepEqual(parseScoreSpec('2,choice'), { response: 2 });
  assert.deepEqual(parseScoreSpec('response=4, choice=2'), { response: 2 });
});
