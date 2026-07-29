const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRuntimeFeatures,
  getRuntimeFeatureConfig,
} = require('../utils/runtimeFeatures');

test('getRuntimeFeatures returns known defaults when env is empty', () => {
  assert.deepEqual(getRuntimeFeatures({}), {
    remoteCpp: false,
    remotePython: false,
  });
});

test('getRuntimeFeatures merges RUNTIME_FEATURE_* flags', () => {
  assert.deepEqual(getRuntimeFeatures({
    RUNTIME_FEATURE_REMOTE_CPP: '1',
    RUNTIME_FEATURE_REMOTE_PYTHON: 'true',
    RUNTIME_FEATURE_SOMETHING_ELSE: 'yes',
  }), {
    remoteCpp: true,
    remotePython: true,
    somethingElse: true,
  });
});

test('getRuntimeFeatureConfig wraps features for API responses', () => {
  assert.deepEqual(getRuntimeFeatureConfig({
    RUNTIME_FEATURE_REMOTE_CPP: '0',
    RUNTIME_FEATURE_REMOTE_PYTHON: '1',
  }), {
    features: {
      remoteCpp: false,
      remotePython: true,
    },
  });
});
