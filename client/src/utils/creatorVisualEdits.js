function isValidRange(range) {
  return Number.isInteger(range?.startLine)
    && Number.isInteger(range?.endLine)
    && range.startLine > 0
    && range.endLine >= range.startLine;
}

// Swap two non-overlapping, one-based line ranges while retaining any text
// between them. This lets a visual edit move an entire parsed question/group
// without needing to understand its nested activity markup.
export function swapSourceRanges(sourceText, firstRange, secondRange) {
  if (!isValidRange(firstRange) || !isValidRange(secondRange)) return sourceText;

  const [first, second] = firstRange.startLine <= secondRange.startLine
    ? [firstRange, secondRange]
    : [secondRange, firstRange];
  if (first.endLine >= second.startLine) return sourceText;

  const lines = String(sourceText || '').split('\n');
  const before = lines.slice(0, first.startLine - 1);
  const firstBlock = lines.slice(first.startLine - 1, first.endLine);
  const between = lines.slice(first.endLine, second.startLine - 1);
  const secondBlock = lines.slice(second.startLine - 1, second.endLine);
  const after = lines.slice(second.endLine);

  return [...before, ...secondBlock, ...between, ...firstBlock, ...after].join('\n');
}

export function getSectionKeyAtLine(sourceText, lineNumber) {
  const lines = String(sourceText || '').split('\n');
  const end = Math.max(0, Math.min(lines.length, Number(lineNumber) - 1));
  let sectionIndex = 0;

  for (let index = 0; index < end; index += 1) {
    if (/^\s*\\section\*?\{/.test(lines[index])) sectionIndex += 1;
  }

  return sectionIndex;
}
