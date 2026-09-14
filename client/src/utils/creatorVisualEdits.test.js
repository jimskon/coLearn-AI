import test from 'node:test';
import assert from 'node:assert/strict';
import { getSectionKeyAtLine, swapSourceRanges } from './creatorVisualEdits.js';

test('swapSourceRanges moves complete question ranges while retaining text between them', () => {
  const source = [
    '\\question{First}',
    '\\textresponse{2}',
    '\\endquestion',
    '',
    '\\question{Second}',
    '\\cpp',
    'int main() {}',
    '\\endcpp',
    '\\endquestion',
  ].join('\n');

  assert.equal(swapSourceRanges(source,
    { startLine: 1, endLine: 3 },
    { startLine: 5, endLine: 9 },
  ), [
    '\\question{Second}',
    '\\cpp',
    'int main() {}',
    '\\endcpp',
    '\\endquestion',
    '',
    '\\question{First}',
    '\\textresponse{2}',
    '\\endquestion',
  ].join('\n'));
});

test('getSectionKeyAtLine keeps groups constrained to their section', () => {
  const source = [
    '\\section{Explore}',
    '\\questiongroup{One}',
    '\\endquestiongroup',
    '\\questiongroup{Two}',
    '\\endquestiongroup',
    '\\section{Apply}',
    '\\questiongroup{Three}',
    '\\endquestiongroup',
  ].join('\n');

  assert.equal(getSectionKeyAtLine(source, 2), 1);
  assert.equal(getSectionKeyAtLine(source, 4), 1);
  assert.equal(getSectionKeyAtLine(source, 7), 2);
});
