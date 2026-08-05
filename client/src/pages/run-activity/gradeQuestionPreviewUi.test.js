import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldShowQuestionGradePreview } from './gradeQuestionPreviewUi.js';

test('sandbox creators can show per-question grading', () => {
  assert.equal(
    shouldShowQuestionGradePreview({
      blockType: 'question',
      canGradeQuestionPreview: true,
      isSandbox: true,
      isTestMode: false,
    }),
    true
  );
});

test('test mode creators can show per-question grading', () => {
  assert.equal(
    shouldShowQuestionGradePreview({
      blockType: 'question',
      canGradeQuestionPreview: true,
      isSandbox: false,
      isTestMode: true,
    }),
    true
  );
});

test('non-question blocks do not show per-question grading', () => {
  assert.equal(
    shouldShowQuestionGradePreview({
      blockType: 'paragraph',
      canGradeQuestionPreview: true,
      isSandbox: true,
      isTestMode: false,
    }),
    false
  );
});

test('blocks without grading permission do not show per-question grading', () => {
  assert.equal(
    shouldShowQuestionGradePreview({
      blockType: 'question',
      canGradeQuestionPreview: false,
      isSandbox: true,
      isTestMode: false,
    }),
    false
  );
});
