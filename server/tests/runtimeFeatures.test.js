const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRuntimeFeatures,
  getRuntimeFeatureConfig,
  getAiModels,
  pickModel,
  isReasoningModel,
  envReasoningEffort,
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
    // Deployment defaults ride alongside the switches: values the client needs
    // before it has parsed an activity. Unset here, so language is English.
    defaults: {
      language: 'English',
    },
    // Model menus (AI_BLOCK_MODELS, CREATOR_MODELS); unset, so the defaults.
    models: {
      aiBlock: ['gpt-6-luna', 'gpt-4o-mini'],
      creator: ['gpt-6-luna', 'gpt-6.1-terra'],
    },
  });
});

test('AI models come from server/.env; unlisted models use the first', () => {
  const env = {
    OPENAI_MODEL: 'model-a',
    AI_BLOCK_MODELS: ' model-b, model-c ,model-b',
  };
  const models = getAiModels(env);
  assert.equal(models.feedback, 'model-a');
  assert.equal(models.grading, 'model-a'); // falls back to OPENAI_MODEL
  assert.deepEqual(models.aiBlock, ['model-b', 'model-c']);
  assert.equal(pickModel('model-c', models.aiBlock), 'model-c');
  assert.equal(pickModel('retired-model', models.aiBlock), 'model-b');
  assert.equal(isReasoningModel('gpt-4o-mini'), false);
  assert.equal(isReasoningModel('gpt-6-luna'), true);
  assert.equal(envReasoningEffort('E', 'low', {}), 'low');
  assert.equal(envReasoningEffort('E', 'low', { E: '' }), '');
  assert.equal(envReasoningEffort('E', '', { E: 'bogus' }), '');
});
