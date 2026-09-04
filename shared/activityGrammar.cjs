/*
 * The activity markup grammar. Single authority.
 *
 * Every part of the system that needs to know what a tag is, how it closes, or
 * where it may appear reads it from here. Before this file the language had six
 * independent definitions -- the runtime parser, the save-gate validator, the
 * visual-editor serializer (twice: a managed-tag set and its own code regexes),
 * the inspector's code-block finder, and the text the AI is taught -- and they
 * disagreed. A document could parse correctly and still be refused by the save
 * gate, which is what made \pythonremote ... \endpython unsaveable.
 *
 * Rules of the road:
 *   - Add a tag HERE first. Consumers derive their behaviour from this file.
 *   - Nothing downstream may hardcode a tag list. If it needs one, export it.
 *   - Completeness is a safety property, not a nicety: the visual editor deletes
 *     question-body content it does not recognise, so a tag missing from this
 *     file is a tag the editor will silently destroy.
 *
 * Deliberately NOT covered: prose documentation and examples. MarkUp.md stays
 * hand-written and is reviewed against this file by a human. This file owns the
 * normative facts only -- which tags exist, how they pair, where they may sit.
 */
(function attachActivityGrammar(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.coLearnActivityGrammar = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {

  const VERSION = 1;

  // ---------------------------------------------------------------------------
  // Code blocks
  //
  // One canonical closer per language family: \endpython closes anything opened
  // with \python*, \endcpp closes anything opened with \cpp*. The longer
  // historical spellings stay valid on read.
  //
  // Family-level rather than a universal bare \end on purpose. Closing by name
  // is what lets the validator say "\endpython closes a python block, but
  // question opened at line 12 is still open"; a bare terminator would pop
  // whatever was on top and leave nothing to compare. Collapsing WITHIN a family
  // costs nothing, because code blocks are leaves and never nest inside one
  // another. Crossing families still errors -- \endcpp on a python block is a
  // real mistake.
  // ---------------------------------------------------------------------------
  const CODE_FAMILIES = {
    python: {
      canonicalCloser: 'endpython',
      members: ['python', 'pythonremote', 'pythonturtle', 'pythondisplay'],
    },
    cpp: {
      canonicalCloser: 'endcpp',
      members: ['cpp', 'cppdisplay'],
    },
  };

  // ---------------------------------------------------------------------------
  // Paired container blocks. `closeTag` is what must terminate them.
  // `scope` records where the block may legally appear, for the validator and
  // for future authoring help.
  // ---------------------------------------------------------------------------
  const CONTAINERS = {
    questiongroup:  { closeTag: '\\endquestiongroup',  scope: 'root' },
    question:       { closeTag: '\\endquestion',       scope: 'questiongroup' },
    ai:             { closeTag: '\\endai',             scope: 'questiongroup' },
    score:          { closeTag: '\\endscore',          scope: 'question' },
    multiplechoice: { closeTag: '\\endmultiplechoice', scope: 'question' },
    file:           { closeTag: '\\endfile',           scope: 'root' },
    table:          { closeTag: '\\endtable',          scope: 'any' },
  };

  // ---------------------------------------------------------------------------
  // Single-line tags, by the scope they belong to. At most one of each per scope.
  // ---------------------------------------------------------------------------
  const SINGLETONS = {
    root: [
      'title', 'name', 'mode', 'language', 'studentlevel',
      'activitycontext', 'aicodeguidance', 'aimode', 'test',
    ],
    question: [
      'responsemode', 'textresponse', 'sampleresponses',
      'feedbackprompt', 'followupprompt', 'aimode',
    ],
    ai: [
      'aimodel', 'aititle', 'aiprompt', 'aiguardrail', 'aicontext', 'aiinput',
    ],
  };

  // Question-scope tags the visual editor's inspector owns: it strips these from
  // the body and re-emits them from its own state. Everything else in a question
  // body must be preserved verbatim.
  // `aimode` is deliberately *not* inspector-managed yet. It is valid markup
  // and must therefore survive a visual-editor edit verbatim, but the current
  // inspector has no dedicated control for it. Adding it to this list before
  // that control exists would cause the serializer to remove it.
  const MANAGED_QUESTION_TAGS = SINGLETONS.question.filter((tag) => tag !== 'aimode');

  // ---------------------------------------------------------------------------
  // Tags that may appear inline in prose, or repeat freely within their parent.
  // These are never "managed" -- an editor must carry them through untouched.
  // ---------------------------------------------------------------------------
  const INLINE_TAGS = [
    'section',    // \section{Title}{minutes?} - structural, but single-line
    'text',       // free prose block
    'info',       // info bubble
    'image', 'link',
    'mono', 'texttt',
    'item',       // list item, inside \begin{itemize}/\begin{enumerate}
    'row',        // table row, inside \table
    'choice',     // inside \multiplechoice
    'retries',    // \retries{n}
    'include',    // pulls in another source document
    'tresponse',  // legacy alias retained for older activities
  ];

  // ---------------------------------------------------------------------------
  // Closed value sets. Kept here so the validator, the editor's dropdowns and
  // the AI's instructions cannot drift apart on what is allowed.
  // ---------------------------------------------------------------------------
  const ENUMS = {
    mode: ['group', 'test', 'assignment', 'demo', 'playground'],
    scoreType: ['response', 'code', 'output'],
    responsemode: ['questions'],
  };

  // Comma-separated evaluation-display flags. `aimode` may occur once in the
  // activity preamble and once in an individual question. A question value
  // overrides the activity value. When neither is supplied, these defaults
  // apply: no positive accepted-answer message and a revise result for a
  // non-accepted answer. Additional flags may be added without changing the
  // markup form.
  const COMMA_LIST_VALUES = {
    aimode: {
      values: ['positive', 'no-positive', 'brief'],
      default: ['no-positive'],
      scopes: ['root', 'question'],
    },
  };

  // ===========================================================================
  // Derived lookups
  // ===========================================================================
  const familyByMember = new Map();
  const familyByCloser = new Map();

  Object.entries(CODE_FAMILIES).forEach(([family, spec]) => {
    familyByCloser.set(spec.canonicalCloser, family);
    spec.members.forEach((member) => {
      familyByMember.set(member, family);
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
    return family ? `\\${CODE_FAMILIES[family].canonicalCloser}` : null;
  }

  /** Every closing tag accepted on read. */
  function acceptedClosers() {
    return Array.from(familyByCloser.keys()).map((tag) => `\\${tag}`);
  }

  function isCodeBlock(blockName) {
    return familyByMember.has(bare(blockName));
  }

  const codeMembers = Array.from(familyByMember.keys()).join('|');
  const CODE_OPEN_RE = new RegExp(`^\\\\(${codeMembers})(?:\\{[^}]*\\})?\\s*$`, 'i');
  const CODE_CLOSE_RE = new RegExp(
    `^\\\\(${Array.from(familyByCloser.keys()).join('|')})\\s*$`,
    'i',
  );

  /** Does this line open a code block? */
  function isCodeOpenLine(line) {
    return CODE_OPEN_RE.test(String(line || '').trim());
  }

  /** Does this line close a code block (any accepted spelling)? */
  function isCodeCloseLine(line) {
    return CODE_CLOSE_RE.test(String(line || '').trim());
  }

  /** Closing tag for a container block, e.g. closeTagFor('question'). */
  function closeTagFor(containerName) {
    return CONTAINERS[bare(containerName)]?.closeTag || null;
  }

  function isContainer(name) {
    return Object.prototype.hasOwnProperty.call(CONTAINERS, bare(name));
  }

  /** The command name in a line, without the backslash: '\\score{2,code}' -> 'score'. */
  function commandName(line) {
    const match = String(line || '').trim().match(/^\\([a-zA-Z]+)/);
    return match ? match[1].toLowerCase() : '';
  }

  /**
   * Every tag the language defines. Used to tell a tag we simply do not know
   * from one we deliberately drop -- the distinction the visual editor needs in
   * order to stop deleting things.
   */
  function allTags() {
    const tags = new Set();
    Object.keys(CONTAINERS).forEach((name) => {
      tags.add(name);
      tags.add(bare(CONTAINERS[name].closeTag));
    });
    familyByMember.forEach((_family, member) => tags.add(member));
    familyByCloser.forEach((_family, closer) => tags.add(closer));
    Object.values(SINGLETONS).forEach((list) => list.forEach((tag) => tags.add(tag)));
    INLINE_TAGS.forEach((tag) => tags.add(tag));
    return tags;
  }

  function isKnownTag(nameOrLine) {
    const name = nameOrLine.includes('\\') ? commandName(nameOrLine) : bare(nameOrLine);
    return allTags().has(name);
  }

  return {
    VERSION,

    // Definitions
    CODE_FAMILIES,
    CONTAINERS,
    SINGLETONS,
    MANAGED_QUESTION_TAGS,
    INLINE_TAGS,
    ENUMS,
    COMMA_LIST_VALUES,

    // Code blocks
    familyOfBlock,
    familyOfCloser,
    closesBlock,
    canonicalCloserFor,
    acceptedClosers,
    isCodeBlock,
    isCodeOpenLine,
    isCodeCloseLine,

    // Containers
    closeTagFor,
    isContainer,

    // Utilities
    commandName,
    allTags,
    isKnownTag,
  };
}));
