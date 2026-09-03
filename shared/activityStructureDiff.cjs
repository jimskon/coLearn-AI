/*
 * What did this change remove?
 *
 * Every write path in the editor -- an AI proposal, a paste-back, a visual
 * editor save -- replaces markup wholesale. Nothing compared the document
 * before a change to the document after it, so a revision that quietly dropped
 * three sample answers and a rubric looked exactly like one that did not.
 *
 * This module answers the only question an instructor actually needs answered
 * before a change is written: what is about to disappear. It is deliberately a
 * structural inventory rather than a text diff -- reordered prose is not a
 * loss, a missing \feedbackprompt is.
 *
 * Reads its vocabulary from the syntax authority, so a tag added to the
 * language is accounted for here without a second edit.
 */
(function attachActivityStructureDiff(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.coLearnActivityStructureDiff = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const grammar = (typeof require === 'function')
    ? require('./activityGrammar.cjs')
    : (typeof globalThis !== 'undefined' ? globalThis.coLearnActivityGrammar : null);

  const FIELD_LABELS = {
    sampleresponses: 'sample answer',
    feedbackprompt: 'feedback prompt',
    followupprompt: 'follow-up prompt',
    responsemode: 'response mode',
    textresponse: 'response box',
  };

  const SCORE_LABELS = {
    response: 'response rubric',
    code: 'code rubric',
    output: 'output rubric',
  };

  const trimmedOf = (line) => String(line || '').trim();

  function braceArgument(line) {
    const match = String(line || '').match(/^\\[A-Za-z]+\{([\s\S]*?)\}\s*$/);
    return match ? match[1].trim() : '';
  }

  /**
   * A structural census of an activity: which questions exist, and what each
   * one carries. Line-scanned rather than parsed, so a document that does not
   * fully validate can still be compared -- which matters, because the whole
   * point is to inspect output that may be damaged.
   */
  function inventoryActivity(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');

    const questions = new Map();
    let sections = 0;
    let groups = 0;
    let aiBlocks = 0;

    let letterCode = 97;
    let current = null;
    let inCode = false;
    let skipUntil = '';

    for (const raw of lines) {
      const line = trimmedOf(raw);

      // Code and file contents are opaque: markup-looking text inside them is
      // content, not structure.
      if (inCode) {
        if (grammar.isCodeCloseLine(line)) inCode = false;
        continue;
      }
      if (skipUntil) {
        if (line.toLowerCase() === skipUntil) skipUntil = '';
        continue;
      }
      if (grammar.isCodeOpenLine(line)) {
        inCode = true;
        if (current) current.codeBlocks += 1;
        continue;
      }
      if (line.startsWith('\\file{')) { skipUntil = '\\endfile'; continue; }

      const name = grammar.commandName(line);

      if (name === 'section') { sections += 1; continue; }

      if (name === 'questiongroup') {
        groups += 1;
        letterCode = 97;
        continue;
      }

      if (name === 'ai') { aiBlocks += 1; continue; }

      if (name === 'question') {
        const qid = `${groups}${String.fromCharCode(letterCode)}`;
        letterCode += 1;
        current = {
          qid,
          prompt: braceArgument(line),
          fields: {},
          scores: {},
          codeBlocks: 0,
          choices: 0,
        };
        questions.set(qid, current);
        continue;
      }

      if (name === 'endquestion') { current = null; continue; }

      if (!current) continue;

      if (name === 'score') {
        const match = line.match(/^\\score\{\s*(\d+)\s*,\s*([a-z]+)\s*\}/i);
        if (match) current.scores[match[2].toLowerCase()] = Number(match[1]);
        skipUntil = '\\endscore';
        continue;
      }

      if (name === 'choice') { current.choices += 1; continue; }

      if (grammar.MANAGED_QUESTION_TAGS.includes(name) || name === 'multiplechoice') {
        current.fields[name] = true;
      }
    }

    return { questions, sections, groups, aiBlocks };
  }

  /**
   * Structural losses from `before` to `after`.
   *
   * Only removals are treated as needing consent. Additions and edits are what
   * the instructor asked for; disappearances are what they did not.
   */
  function diffActivityStructure(beforeText, afterText) {
    const before = inventoryActivity(beforeText);
    const after = inventoryActivity(afterText);

    const removals = [];
    const additions = [];

    for (const [qid, was] of before.questions) {
      const now = after.questions.get(qid);

      if (!now) {
        removals.push({
          kind: 'question',
          qid,
          label: 'question',
          detail: was.prompt.slice(0, 70),
        });
        continue;
      }

      for (const field of Object.keys(was.fields)) {
        if (!now.fields[field]) {
          removals.push({
            kind: 'field',
            qid,
            field,
            label: FIELD_LABELS[field] || field,
          });
        }
      }

      for (const [type, points] of Object.entries(was.scores)) {
        if (now.scores[type] === undefined) {
          removals.push({
            kind: 'score',
            qid,
            field: type,
            label: SCORE_LABELS[type] || `${type} rubric`,
            detail: `${points} pts`,
          });
        }
      }

      if (now.codeBlocks < was.codeBlocks) {
        removals.push({
          kind: 'codeblock',
          qid,
          label: 'code block',
          detail: `${was.codeBlocks - now.codeBlocks} removed`,
        });
      }

      if (now.choices < was.choices) {
        removals.push({
          kind: 'choice',
          qid,
          label: 'answer choice',
          detail: `${was.choices - now.choices} removed`,
        });
      }
    }

    for (const qid of after.questions.keys()) {
      if (!before.questions.has(qid)) additions.push({ kind: 'question', qid, label: 'question' });
    }

    if (after.groups < before.groups) {
      removals.push({
        kind: 'group',
        label: 'question group',
        detail: `${before.groups - after.groups} removed`,
      });
    }
    if (after.sections < before.sections) {
      removals.push({
        kind: 'section',
        label: 'section',
        detail: `${before.sections - after.sections} removed`,
      });
    }
    if (after.aiBlocks < before.aiBlocks) {
      removals.push({
        kind: 'ai',
        label: 'AI help block',
        detail: `${before.aiBlocks - after.aiBlocks} removed`,
      });
    }

    return {
      removals,
      additions,
      hasRemovals: removals.length > 0,
      summary: summarizeRemovals(removals),
      counts: {
        before: { questions: before.questions.size, groups: before.groups, sections: before.sections },
        after: { questions: after.questions.size, groups: after.groups, sections: after.sections },
      },
    };
  }

  /**
   * Removals grouped for display: one row per kind of thing lost, listing the
   * questions affected. "3 sample answers (2a, 2b, 4c)" rather than three rows.
   */
  function summarizeRemovals(removals) {
    const rows = new Map();
    for (const removal of removals) {
      const key = `${removal.kind}:${removal.field || ''}`;
      if (!rows.has(key)) rows.set(key, { kind: removal.kind, label: removal.label, count: 0, qids: [] });
      const row = rows.get(key);
      row.count += 1;
      if (removal.qid) row.qids.push(removal.qid);
    }
    return Array.from(rows.values());
  }

  /** One human-readable line per row, for a confirmation prompt. */
  function describeRemovals(diff) {
    return (diff?.summary || []).map((row) => {
      const plural = row.count === 1 ? row.label : `${row.label}s`;
      const where = row.qids.length ? `  (${row.qids.join(', ')})` : '';
      return `${row.count} ${plural}${where}`;
    });
  }

  return {
    inventoryActivity,
    diffActivityStructure,
    describeRemovals,
    FIELD_LABELS,
    SCORE_LABELS,
  };
}));
