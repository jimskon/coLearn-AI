// Line diff for showing how a saved file changed between versions. Plain JS
// (no React) so it can be unit-tested with node.

// Above this many line pairs the LCS table gets too big for the browser; show
// the change as a full replacement instead.
const MAX_CELLS = 4_000_000;

function toLines(text) {
  const s = String(text ?? '').replace(/\r\n/g, '\n');
  return s === '' ? [] : s.split('\n');
}

// Returns [{ type: 'same' | 'add' | 'del', text }] turning oldText into newText.
export function diffLines(oldText, newText) {
  const a = toLines(oldText);
  const b = toLines(newText);

  // Trim the common prefix and suffix; edits are usually small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const prefix = a.slice(0, start).map((text) => ({ type: 'same', text }));
  const suffix = a.slice(endA).map((text) => ({ type: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_CELLS) {
    return [
      ...prefix,
      ...midA.map((text) => ({ type: 'del', text })),
      ...midB.map((text) => ({ type: 'add', text })),
      ...suffix,
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of midA[i..] and midB[j..]
  const n = midA.length;
  const m = midB.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = midA[i] === midB[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const middle = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ type: 'same', text: midA[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      middle.push({ type: 'del', text: midA[i] });
      i += 1;
    } else {
      middle.push({ type: 'add', text: midB[j] });
      j += 1;
    }
  }
  while (i < n) middle.push({ type: 'del', text: midA[i++] });
  while (j < m) middle.push({ type: 'add', text: midB[j++] });

  return [...prefix, ...middle, ...suffix];
}

// Keeps `context` unchanged lines around each change and replaces longer runs
// with { type: 'skip', count }.
export function collapseUnchanged(diff, context = 3) {
  const keep = new Array(diff.length).fill(false);
  diff.forEach((line, index) => {
    if (line.type === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(diff.length - 1, index + context); k += 1) {
      keep[k] = true;
    }
  });

  const out = [];
  let skipped = 0;
  diff.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) out.push({ type: 'skip', count: skipped });
      skipped = 0;
      out.push(line);
    } else {
      skipped += 1;
    }
  });
  if (skipped) out.push({ type: 'skip', count: skipped });
  return out;
}

export function countChanges(diff) {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.type === 'add') added += 1;
    else if (line.type === 'del') removed += 1;
  }
  return { added, removed };
}
