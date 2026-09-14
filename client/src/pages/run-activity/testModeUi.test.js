import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldHideStudentTestSections,
  shouldSuppressStudentTestFeedbackUi,
} from './testModeUi.js';

test('student test mode hides feedback ui and sections', () => {
  assert.equal(
    shouldSuppressStudentTestFeedbackUi({ isTestMode: true, isStudent: true, runMode: 'run' }),
    true
  );
  assert.equal(
    shouldHideStudentTestSections({ isTestMode: true, isStudent: true, runMode: 'run' }),
    true
  );
});

test('preview and instructor views keep feedback ui available', () => {
  assert.equal(
    shouldSuppressStudentTestFeedbackUi({ isTestMode: true, isStudent: true, runMode: 'preview' }),
    false
  );
  assert.equal(
    shouldHideStudentTestSections({ isTestMode: true, isStudent: false, runMode: 'run' }),
    false
  );
  assert.equal(
    shouldSuppressStudentTestFeedbackUi({ isTestMode: true, isStudent: false, runMode: 'run' }),
    false
  );
});
