'use strict';

// Size measures for comparing two versions of an answer. Descriptive only:
// none of these says anything about whether a revision was better.

// Above this many characters (or line pairs) exact algorithms get too slow for
// a request; results are then marked approximate.
const MAX_EDIT_CHARS = 4000;
const MAX_LINE_CELLS = 2_000_000;

function normalize(text) {
  return String(text ?? '').replace(/\r\n/g, '\n');
}

function charCount(text) {
  return normalize(text).length;
}

function wordCount(text) {
  const t = normalize(text).trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Levenshtein distance (insert, delete, substitute = 1). For texts longer than
 * MAX_EDIT_CHARS, returns a lower bound (the length difference plus changed
 * lines' characters) and approximate: true.
 */
function editDistance(a, b) {
  const s = normalize(a);
  const t = normalize(b);
  if (s === t) return { distance: 0, approximate: false };
  if (s.length > MAX_EDIT_CHARS || t.length > MAX_EDIT_CHARS) {
    const { removedChars, addedChars } = lineChanges(s, t);
    return { distance: Math.max(removedChars, addedChars), approximate: true };
  }
  let prev = new Uint32Array(t.length + 1);
  let cur = new Uint32Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s.charCodeAt(i - 1) === t.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return { distance: prev[t.length], approximate: false };
}

/** distance / length of the longer text, in [0, 1]. 0 when both are empty. */
function normalizedEditDistance(a, b) {
  const longer = Math.max(charCount(a), charCount(b));
  if (!longer) return { value: 0, approximate: false };
  const { distance, approximate } = editDistance(a, b);
  return { value: Math.min(1, distance / longer), approximate };
}

/** Lines added and removed between two texts (LCS on lines). */
function lineChanges(a, b) {
  const x = normalize(a) === '' ? [] : normalize(a).split('\n');
  const y = normalize(b) === '' ? [] : normalize(b).split('\n');

  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start += 1;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX -= 1;
    endY -= 1;
  }
  const midX = x.slice(start, endX);
  const midY = y.slice(start, endY);

  let common = 0;
  if (midX.length * midY.length <= MAX_LINE_CELLS) {
    const lcs = Array.from({ length: midX.length + 1 }, () => new Uint32Array(midY.length + 1));
    for (let i = midX.length - 1; i >= 0; i -= 1) {
      for (let j = midY.length - 1; j >= 0; j -= 1) {
        lcs[i][j] = midX[i] === midY[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    common = lcs[0][0];
  }

  // Characters on changed lines, used as an approximate edit size for long texts.
  const removedSet = midX.length - common;
  const addedSet = midY.length - common;
  const chars = (lines) => lines.reduce((n, l) => n + l.length + 1, 0);
  return {
    linesRemoved: removedSet,
    linesAdded: addedSet,
    removedChars: common ? Math.round(chars(midX) * (removedSet / Math.max(1, midX.length))) : chars(midX),
    addedChars: common ? Math.round(chars(midY) * (addedSet / Math.max(1, midY.length))) : chars(midY),
  };
}

module.exports = {
  MAX_EDIT_CHARS,
  charCount,
  wordCount,
  editDistance,
  normalizedEditDistance,
  lineChanges,
};
