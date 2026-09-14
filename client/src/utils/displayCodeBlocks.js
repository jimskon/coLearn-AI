export function parseDisplayCodeBlockCommand(line = '') {
  const trimmed = String(line || '').trim();

  const openMatch = trimmed.match(/^\\(python|cpp)display(?:\{([^}]*)\})?$/i);
  if (openMatch) {
    const language = openMatch[1].toLowerCase();
    return {
      kind: 'open',
      type: `${language}display`,
      language,
      timeout: (openMatch[2] || '').trim() || null,
    };
  }

  const closeMatch = trimmed.match(/^\\end(python|cpp)display$/i);
  if (closeMatch) {
    const language = closeMatch[1].toLowerCase();
    return {
      kind: 'close',
      type: `${language}display`,
      language,
    };
  }

  return null;
}

export function createDisplayCodeBlock({ type, language, displayLine }) {
  return {
    type,
    language,
    displayOnly: true,
    lines: [],
    sourceMeta: {
      displayLine,
      endDisplayLine: null,
    },
  };
}
