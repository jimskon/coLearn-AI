import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMetric, formatSeconds, toAggregateCsv } from '../src/utils/researchFormat.js';

test('seconds read naturally, including negatives', () => {
  assert.equal(formatSeconds(42), '42s');
  assert.equal(formatSeconds(125), '2m 05s');
  assert.equal(formatSeconds(3725), '1h 02m');
  assert.equal(formatSeconds(-321), '−5m 21s');
  assert.equal(formatSeconds(null), '—');
});

test('rates always show numerator and denominator', () => {
  assert.deepEqual(
    formatMetric({ kind: 'rate', numerator: 527, denominator: 2269, value: 527 / 2269 }),
    { main: '23.2%', detail: '527 / 2,269' }
  );
  assert.deepEqual(formatMetric({ kind: 'rate', numerator: 0, denominator: 0, value: null }), { main: '—', detail: '0 / 0' });
});

test('summaries show median with mean, range, and n', () => {
  const m = formatMetric({ kind: 'summary', unit: 'seconds', n: 3, mean: 90, median: 60, min: 30, max: 180 });
  assert.equal(m.main, 'median 1m 00s');
  assert.equal(m.detail, 'mean 1m 30s · range 30s–3m 00s · n=3');
  assert.deepEqual(formatMetric({ kind: 'summary', n: 0 }), { main: '—', detail: 'n=0' });
});

test('aggregate CSV has one row per metric and quotes text safely', () => {
  const csv = toAggregateCsv({
    sections: { aiGating: [{ key: 'r', label: 'Rate, "quoted"', kind: 'rate', numerator: 1, denominator: 4, value: 0.25, description: 'd' }] },
    breakdowns: { groupSize: [{ key: '2', label: '2 students', metrics: [{ key: 'c', label: 'Count', kind: 'count', value: 3 }] }] },
    excluded: { tests: 2 },
  });
  const lines = csv.split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('section,breakdown,group,key,label'));
  assert.ok(lines[1].includes('"Rate, ""quoted"""'));
  assert.ok(lines[2].startsWith('breakdown,group_size,2 students,c,Count'));
  assert.ok(lines[3].startsWith('excluded,,,tests,tests,count,,2'));
});
