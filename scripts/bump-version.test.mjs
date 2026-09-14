import test from 'node:test';
import assert from 'node:assert/strict';
import { incrementVersion } from './bump-version.mjs';

test('incrementVersion advances patch, minor, and major releases', () => {
  assert.equal(incrementVersion('0.9.1', 'patch'), '0.9.2');
  assert.equal(incrementVersion('0.9.1', 'minor'), '0.10.0');
  assert.equal(incrementVersion('0.9.1', 'major'), '1.0.0');
});

test('incrementVersion rejects invalid version text and bump kinds', () => {
  assert.throws(() => incrementVersion('0.9', 'patch'), /major\.minor\.patch/);
  assert.throws(() => incrementVersion('0.9.1', 'build'), /Usage/);
});
