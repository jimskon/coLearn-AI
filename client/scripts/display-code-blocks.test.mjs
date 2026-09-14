import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDisplayCodeBlock,
  parseDisplayCodeBlockCommand,
} from '../src/utils/displayCodeBlocks.js';

test('recognizes Python and C++ display-only code block commands', () => {
  assert.deepEqual(parseDisplayCodeBlockCommand('\\pythondisplay'), {
    kind: 'open',
    type: 'pythondisplay',
    language: 'python',
    timeout: null,
  });

  assert.deepEqual(parseDisplayCodeBlockCommand('\\cppdisplay{ignored}'), {
    kind: 'open',
    type: 'cppdisplay',
    language: 'cpp',
    timeout: 'ignored',
  });

  assert.deepEqual(parseDisplayCodeBlockCommand('\\endpythondisplay'), {
    kind: 'close',
    type: 'pythondisplay',
    language: 'python',
  });

  assert.deepEqual(parseDisplayCodeBlockCommand('\\endcppdisplay'), {
    kind: 'close',
    type: 'cppdisplay',
    language: 'cpp',
  });
});

test('creates display-only code block state for rendering', () => {
  assert.deepEqual(createDisplayCodeBlock({
    type: 'pythondisplay',
    language: 'python',
    displayLine: 12,
  }), {
    type: 'pythondisplay',
    language: 'python',
    displayOnly: true,
    lines: [],
    sourceMeta: {
      displayLine: 12,
      endDisplayLine: null,
    },
  });
});
