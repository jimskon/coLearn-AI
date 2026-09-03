/*
 * Which closing tags may close which code blocks.
 *
 * One canonical closer per language family: \endpython closes anything that
 * opened with \python*, \endcpp closes anything that opened with \cpp*. The
 * longer historical forms (\endpythonremote, \endpythonturtle, \endcppdisplay)
 * stay accepted on read so no existing activity breaks; new markup should emit
 * the canonical closer.
 *
 * Family-level rather than universal on purpose. Closing by name is what lets
 * the validator say "\endpython closes a python block, but question opened at
 * line 12 is still open" -- a bare \end would pop whatever was on top and that
 * check would have nothing to compare. Collapsing WITHIN a family costs nothing,
 * because code blocks are leaves: they never nest inside one another, so which
 * python variant a closer names was never load-bearing. Crossing families still
 * errors, because \endcpp on a python block is a real mistake.
 *
 * This is the seed of the single syntax definition. Everything that needs to
 * know how code blocks close reads it from here rather than restating it.
 */
(function attachCodeBlockFamilies(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.coLearnCodeBlockFamilies = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const FAMILIES = {
    python: {
      canonicalCloser: 'endpython',
      members: ['python', 'pythonremote', 'pythonturtle', 'pythondisplay'],
    },
    cpp: {
      canonicalCloser: 'endcpp',
      members: ['cpp', 'cppdisplay'],
    },
  };

  const familyByMember = new Map();
  const familyByCloser = new Map();

  Object.entries(FAMILIES).forEach(([family, spec]) => {
    familyByCloser.set(spec.canonicalCloser, family);
    spec.members.forEach((member) => {
      familyByMember.set(member, family);
      // \endpythonremote and friends remain valid input.
      familyByCloser.set(`end${member}`, family);
    });
  });

  const bare = (tag) => String(tag || '').trim().replace(/^\\/, '').toLowerCase();

  /** Family a block name belongs to, or null if it is not a code block. */
  function familyOfBlock(blockName) {
    return familyByMember.get(bare(blockName)) || null;
  }

  /** Family a closing tag belongs to, or null if it does not close a code block. */
  function familyOfCloser(closerTag) {
    return familyByCloser.get(bare(closerTag)) || null;
  }

  /** True when this closing tag may close this block. */
  function closesBlock(closerTag, blockName) {
    const family = familyOfCloser(closerTag);
    return !!family && family === familyOfBlock(blockName);
  }

  /** The closer that should be WRITTEN for a block, e.g. '\\endpython'. */
  function canonicalCloserFor(blockName) {
    const family = familyOfBlock(blockName);
    return family ? `\\${FAMILIES[family].canonicalCloser}` : null;
  }

  /** Every closing tag accepted on read, e.g. ['\\endpython', ...]. */
  function acceptedClosers() {
    return Array.from(familyByCloser.keys()).map((tag) => `\\${tag}`);
  }

  function isCodeBlock(blockName) {
    return familyByMember.has(bare(blockName));
  }

  return {
    FAMILIES,
    familyOfBlock,
    familyOfCloser,
    closesBlock,
    canonicalCloserFor,
    acceptedClosers,
    isCodeBlock,
  };
}));
