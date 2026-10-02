import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseUnchanged, countChanges, diffLines } from '../src/utils/lineDiff.js';

const kinds = (diff) => diff.map((d) => `${d.type}:${d.text}`);

test('identical text has no changes', () => {
  const diff = diffLines('a\nb', 'a\nb');
  assert.deepEqual(countChanges(diff), { added: 0, removed: 0 });
});

test('finds an inserted line in the middle', () => {
  assert.deepEqual(kinds(diffLines('a\nb\nc', 'a\nb\nx\nc')), ['same:a', 'same:b', 'add:x', 'same:c']);
});

test('finds a replaced line', () => {
  const diff = diffLines('void f() {\n  // TODO\n}', 'void f() {\n  head = n;\n}');
  assert.deepEqual(kinds(diff), ['same:void f() {', 'del:  // TODO', 'add:  head = n;', 'same:}']);
  assert.deepEqual(countChanges(diff), { added: 1, removed: 1 });
});

test('handles empty old or new text', () => {
  assert.deepEqual(kinds(diffLines('', 'a\nb')), ['add:a', 'add:b']);
  assert.deepEqual(kinds(diffLines('a', '')), ['del:a']);
  assert.deepEqual(diffLines('', ''), []);
});

test('ignores Windows line endings', () => {
  assert.deepEqual(countChanges(diffLines('a\r\nb', 'a\nb')), { added: 0, removed: 0 });
});

test('collapses long unchanged runs but keeps context', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
  const after = before.replace('line10', 'changed');
  const collapsed = collapseUnchanged(diffLines(before, after), 2);
  assert.deepEqual(kinds(collapsed), [
    'skip:undefined',
    'same:line8', 'same:line9', 'del:line10', 'add:changed', 'same:line11', 'same:line12',
    'skip:undefined',
  ]);
  assert.equal(collapsed[0].count, 8);
  assert.equal(collapsed[collapsed.length - 1].count, 7);
});
