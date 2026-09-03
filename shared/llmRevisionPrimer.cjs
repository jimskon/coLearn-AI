/*
 * The briefing an external LLM needs before it is allowed to touch an activity.
 *
 * Whole-activity AI revision used to happen inside the app: the server sent the
 * document to a model and wrote back whatever came out. It was removed because
 * the failure mode was silent -- a response that parsed cleanly and had lost
 * three sample answers looked exactly like one that had not -- and because a
 * conversation with a model the instructor can see and argue with produces
 * better rewrites than a single blind request.
 *
 * What replaced it is this: the app hands the instructor a briefing plus their
 * activity, they work with any model they like, and they paste the result back
 * through a review gate. This file is the briefing.
 *
 * The normative facts -- which tags exist, how they close, what values are
 * allowed -- are read from the grammar rather than restated, so a tag added to
 * the language cannot go missing from the instructions the model is given. Only
 * the prose is hand-written.
 */
(function attachLlmRevisionPrimer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.coLearnLlmRevisionPrimer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const grammar = (typeof require === 'function')
    ? require('./activityGrammar.cjs')
    : (typeof globalThis !== 'undefined' ? globalThis.coLearnActivityGrammar : null);

  const tag = (name) => `\\${name}`;
  const list = (names) => names.map(tag).join(', ');

  function codeBlockRules() {
    return Object.entries(grammar.CODE_FAMILIES).map(([, spec]) => {
      const openers = spec.members.map((member) => tag(member)).join(', ');
      return `  ${openers} all close with \\${spec.canonicalCloser}`;
    });
  }

  function containerRules() {
    return Object.entries(grammar.CONTAINERS).map(([name, spec]) => {
      const where = spec.scope === 'root' ? 'at the top level'
        : spec.scope === 'any' ? 'anywhere'
          : `inside \\${spec.scope}`;
      return `  ${tag(name)} ... ${spec.closeTag}   (${where})`;
    });
  }

  /**
   * The instructions themselves. Written to a model that has never seen this
   * markup, and whose most likely mistakes are: returning a fragment instead of
   * the whole document, dropping the parts students never see (sample answers,
   * feedback prompts, rubrics), and inventing tags.
   */
  function buildPrimer() {
    return [
      'You are revising a coLearn-AI activity written in a LaTeX-like markup.',
      'I will paste the complete activity below. Make only the changes I ask for.',
      '',
      'RULES -- these matter more than the change I am asking for:',
      '',
      '1. Return the COMPLETE activity, from the first line to the last. Not a',
      '   patch, not an excerpt, not "...unchanged...". If you cannot return all',
      '   of it, say so instead of returning part of it.',
      '2. Do not remove anything I did not ask you to remove. In particular, the',
      '   instructor-facing tags are easy to mistake for scaffolding and are the',
      '   most valuable part of the file:',
      `     ${tag('sampleresponses')}   what a good answer looks like`,
      `     ${tag('feedbackprompt')}    how the AI should judge the answer`,
      `     ${tag('followupprompt')}    what to ask next`,
      `     ${tag('score')} ... ${grammar.CONTAINERS.score.closeTag}   the grading rubric`,
      '3. Do not invent tags. The complete vocabulary is listed below. If you',
      '   need something that is not there, write it as plain prose.',
      '4. Keep code inside code blocks exactly as it is unless I ask about the',
      '   code. Never reindent or "tidy" it.',
      '5. Return the markup as a plain fenced code block and nothing else.',
      '',
      'DOCUMENT SHAPE',
      '',
      `  ${tag('title')}{...} and ${tag('name')}{...} come first.`,
      `  ${tag('section')}{Title}{minutes} divides the activity; the minutes are optional.`,
      '  Every question lives inside a \\questiongroup ... \\endquestiongroup.',
      '  Question numbering is positional: the Nth group, then a, b, c within it.',
      '  Moving a question changes its number, which detaches it from student',
      '  work already recorded against it. Prefer editing in place.',
      '',
      'PAIRED BLOCKS',
      '',
      ...containerRules(),
      '',
      'CODE BLOCKS',
      '',
      ...codeBlockRules(),
      '  The longer spellings (\\endpythonremote and friends) still read',
      '  correctly, but write the short one.',
      '',
      'SINGLE-LINE TAGS, by where they belong',
      '',
      `  top level:    ${list(grammar.SINGLETONS.root)}`,
      `  in a question: ${list(grammar.SINGLETONS.question)}`,
      `  in an \\ai block: ${list(grammar.SINGLETONS.ai)}`,
      `  anywhere:     ${list(grammar.INLINE_TAGS)}`,
      '',
      'FIXED VALUE SETS',
      '',
      `  ${tag('mode')}{...}: ${grammar.ENUMS.mode.join(' | ')}`,
      `  ${tag('score')}{points,type}: type is ${grammar.ENUMS.scoreType.join(' | ')}`,
      '',
      'WHAT I WANT CHANGED',
      '',
      '  <<< describe your change here >>>',
      '',
      'THE ACTIVITY',
    ].join('\n');
  }

  const LLM_REVISION_PRIMER = buildPrimer();

  /** Primer plus the activity, ready for the clipboard. */
  function buildLlmRevisionPrompt(activityText) {
    return `${LLM_REVISION_PRIMER}\n\n\`\`\`\n${String(activityText || '').trim()}\n\`\`\`\n`;
  }

  /**
   * The markup out of whatever came back from the model.
   *
   * Chat models wrap answers in fences and add a sentence either side however
   * firmly they are told not to. Making the instructor strip that by hand is
   * making them hand-edit markup, which is the thing this workflow exists to
   * avoid. Anything before the first structural tag is chatter; a fenced block
   * wins over the surrounding text.
   */
  function extractMarkupFromPaste(pasted) {
    const text = String(pasted || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return '';
    const fenced = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    const body = (fenced ? fenced[1] : text).trim();
    const start = body.search(/^\\(title|name|mode|section|questiongroup)\{/m);
    return (start > 0 ? body.slice(start) : body).trim();
  }

  return { LLM_REVISION_PRIMER, buildLlmRevisionPrompt, buildPrimer, extractMarkupFromPaste };
}));
