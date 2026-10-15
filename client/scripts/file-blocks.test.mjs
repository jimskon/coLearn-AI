import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fileLanguage,
  fileResponseKey,
  isFileResponseKey,
  parseFileOptions,
} from '../src/utils/fileBlocks.js';

test('parses filename and options in any order and case', () => {
  assert.deepEqual(parseFileOptions('data.txt'), { filename: 'data.txt', readonly: false, shared: false });
  assert.deepEqual(parseFileOptions('data.txt, readonly'), { filename: 'data.txt', readonly: true, shared: false });
  assert.deepEqual(parseFileOptions(' List.h , Shared '), { filename: 'List.h', readonly: false, shared: true });
  assert.deepEqual(parseFileOptions(''), { filename: '', readonly: false, shared: false });
});

test('readonly wins over shared', () => {
  assert.deepEqual(parseFileOptions('List.h, shared, readonly'), { filename: 'List.h', readonly: true, shared: false });
});

test('builds storage keys only for safe filenames', () => {
  assert.equal(fileResponseKey('LinkedList.h'), 'file:LinkedList.h');
  assert.equal(fileResponseKey('my_data-2.csv'), 'file:my_data-2.csv');
  assert.equal(fileResponseKey('dir/List.h'), null);
  assert.equal(fileResponseKey('my file.txt'), null);
  assert.equal(fileResponseKey(''), null);
  assert.equal(isFileResponseKey('file:List.h'), true);
  assert.equal(isFileResponseKey('1acode1'), false);
});

test('picks a highlighting language from the extension', () => {
  assert.equal(fileLanguage('List.h'), 'cpp');
  assert.equal(fileLanguage('List.HPP'), 'cpp');
  assert.equal(fileLanguage('main.cpp'), 'cpp');
  assert.equal(fileLanguage('helpers.py'), 'python');
  assert.equal(fileLanguage('data.txt'), null);
  assert.equal(fileLanguage('Makefile'), null);
});
