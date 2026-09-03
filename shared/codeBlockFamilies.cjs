/*
 * Back-compatibility shim.
 *
 * Code-block families moved into shared/activityGrammar.cjs, which is now the
 * single syntax authority. This file re-exports that subset so existing imports
 * keep working; new code should import the grammar directly.
 */
(function attachCodeBlockFamilies(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.coLearnCodeBlockFamilies = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const grammar = (typeof require === 'function')
    ? require('./activityGrammar.cjs')
    : (typeof globalThis !== 'undefined' ? globalThis.coLearnActivityGrammar : null);

  return {
    FAMILIES: grammar.CODE_FAMILIES,
    familyOfBlock: grammar.familyOfBlock,
    familyOfCloser: grammar.familyOfCloser,
    closesBlock: grammar.closesBlock,
    canonicalCloserFor: grammar.canonicalCloserFor,
    acceptedClosers: grammar.acceptedClosers,
    isCodeBlock: grammar.isCodeBlock,
  };
}));
