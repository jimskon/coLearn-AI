const test = require('node:test');
const assert = require('node:assert/strict');

// This parser test must stay independent of the activity controller, which
// loads AI integrations that have no bearing on markup-score parsing.
const { parseScoreSpec } = require('../activity_instances/scoreSpec');

test('parseScoreSpec accepts only response, code, and output score bands', () => {
  assert.deepEqual(parseScoreSpec('2,response'), { response: 2 });
  assert.deepEqual(parseScoreSpec('2,code'), { code: 2 });
  assert.deepEqual(parseScoreSpec('2,output'), { output: 2 });
  assert.deepEqual(parseScoreSpec('2,manual'), {});
  assert.deepEqual(parseScoreSpec('2,auto'), {});
  assert.deepEqual(parseScoreSpec('2,choice'), {});
});
