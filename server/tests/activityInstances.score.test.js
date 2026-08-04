const test = require('node:test');
const assert = require('node:assert/strict');

const { parseScoreSpec } = require('../activity_instances/controller');

test('parseScoreSpec accepts only response, code, and output score bands', () => {
  assert.deepEqual(parseScoreSpec('2,response'), { response: 2 });
  assert.deepEqual(parseScoreSpec('2,code'), { code: 2 });
  assert.deepEqual(parseScoreSpec('2,output'), { output: 2 });
  assert.deepEqual(parseScoreSpec('2,manual'), {});
  assert.deepEqual(parseScoreSpec('2,auto'), {});
  assert.deepEqual(parseScoreSpec('2,choice'), {});
});
