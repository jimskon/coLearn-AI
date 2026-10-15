// Helpers for \file{name, options} blocks. Kept free of React so they can be
// unit-tested with plain node.
//
//   \file{data.txt}             editable, local to each browser (not saved)
//   \file{data.txt, readonly}   nobody can edit
//   \file{List.h, shared}       the active student edits; teammates follow;
//                               saved with the group's submission
//
// In tests every editable file is saved, shared or not.

export const FILE_KEY_PREFIX = 'file:';

// Must match server/utils/questionId.js.
const SAFE_FILENAME = /^[A-Za-z0-9._-]{1,128}$/;

export function parseFileOptions(inner) {
  const parts = String(inner || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const flags = new Set(parts.slice(1).map((s) => s.toLowerCase()));
  const readonly = flags.has('readonly');
  return {
    filename: parts[0] || '',
    readonly,
    shared: flags.has('shared') && !readonly,
  };
}

export function isSaveableFilename(filename) {
  return SAFE_FILENAME.test(String(filename || ''));
}

// Response key used to store a file's contents, or null if the name can't be stored.
export function fileResponseKey(filename) {
  return isSaveableFilename(filename) ? `${FILE_KEY_PREFIX}${filename}` : null;
}

export function isFileResponseKey(key) {
  return String(key || '').startsWith(FILE_KEY_PREFIX);
}

const LANGUAGE_BY_EXTENSION = {
  h: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  c: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  py: 'python',
};

// Prism language for syntax highlighting, or null for plain text.
export function fileLanguage(filename) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(filename || ''));
  return match ? LANGUAGE_BY_EXTENSION[match[1].toLowerCase()] || null : null;
}

// Authored contents of every \file block, by filename, from the run page's
// preamble and groups (files may sit outside question groups).
export function collectStarterFiles(preamble = [], groups = []) {
  const files = {};
  const lists = [preamble, ...groups.flatMap((g) => [g?.prelude, [g?.intro], g?.content])];
  for (const list of lists) {
    for (const block of list || []) {
      if (block?.type === 'file' && block.filename && !(block.filename in files)) {
        files[block.filename] = block.content || '';
      }
    }
  }
  return files;
}
