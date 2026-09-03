/*
 * Structural validation shared by the browser editor and the server.
 *
 * This deliberately checks only the markup structure that can corrupt an
 * activity when an editor tries to update it.  It is not a content/rubric
 * validator: ordinary prose and repeatable blocks (code, choices, files,
 * etc.) remain valid.
 */
// Tag vocabulary comes from the syntax authority, never restated here.
const grammar = (typeof require === 'function')
  ? require('./activityGrammar.cjs')
  : (typeof globalThis !== 'undefined' ? globalThis.coLearnActivityGrammar : null);

const { closesBlock, canonicalCloserFor } = grammar;

(function attachMarkupValidator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.coLearnMarkupValidation = api;
}(typeof globalThis === 'undefined' ? null : globalThis, function createMarkupValidator() {
  const ROOT_SINGLETONS = new Set(grammar.SINGLETONS.root);
  // multiplechoice is a container, but at most one may open per question, so the
  // validator counts it alongside the question-scope singletons.
  const QUESTION_SINGLETONS = new Set([...grammar.SINGLETONS.question, 'multiplechoice']);
  const AI_SINGLETONS = new Set(grammar.SINGLETONS.ai);
  // Kinds only: which closer each accepts is decided by closesBlock().
  const CODE_OPENERS = Object.fromEntries(
    Object.values(grammar.CODE_FAMILIES)
      .flatMap((family) => family.members)
      .map((member) => [member, grammar.canonicalCloserFor(member).replace(/^\\/, '')]),
  );

  function validateActivityMarkup(text) {
    const issues = [];
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const stack = [];
    const seenRoot = new Map();
    let group = null;
    let question = null;
    let ai = null;

    const report = (line, message, code = 'structure') => issues.push({ line, message, code, severity: 'error' });
    const duplicate = (tag, line, firstLine, scope) => report(
      line,
      `Duplicate \\${tag} in this ${scope}. Keep the one at line ${firstLine} or replace it; do not keep both.`,
      'duplicate-tag',
    );
    const markOnce = (seen, tag, line, scope) => {
      if (seen.has(tag)) duplicate(tag, line, seen.get(tag), scope);
      else seen.set(tag, line);
    };
    const current = () => stack[stack.length - 1] || null;
    const open = (kind, line) => stack.push({ kind, line });
    const close = (kind, line, label) => {
      const top = current();
      if (!top) {
        report(line, `\\${label} has no matching open block.`, 'unmatched-close');
        return false;
      }
      if (top.kind !== kind) {
        report(line, `\\${label} closes a ${kind} block, but ${top.kind} opened at line ${top.line} is still open.`, 'invalid-nesting');
        return false;
      }
      stack.pop();
      return true;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = index + 1;
      const value = lines[index].trim();
      if (!value) continue;

      const codeClose = /^\\end(python|pythonremote|pythonturtle|cpp|pythondisplay|cppdisplay)$/i.exec(value);
      if (codeClose) {
        // Any closer from a language family closes any block in that family, so
        // \endpython closes \pythonremote. Report against the block that is
        // actually open when they match, which keeps the useful message for a
        // genuine mismatch (\endcpp while python is open, or a closer arriving
        // while a question is still on the stack).
        const openKind = current()?.kind;
        const label = `end${codeClose[1]}`;
        const effectiveKind = closesBlock(value, openKind) ? openKind : codeClose[1].toLowerCase();
        close(effectiveKind, line, label);
        continue;
      }
      if (current() && Object.prototype.hasOwnProperty.call(CODE_OPENERS, current().kind)) {
        continue; // markup-looking text in code is code, not activity markup.
      }
      if (value === '\\endscore') {
        close('score', line, 'endscore');
        continue;
      }
      if (value === '\\endfile') {
        close('file', line, 'endfile');
        continue;
      }
      if (current()?.kind === 'file' || current()?.kind === 'score') {
        continue; // File and scoring contents are free-form until their closing tag.
      }
      const codeOpen = /^\\(python|pythonremote|pythonturtle|cpp)(?:\{[^}]*\})?$/i.exec(value)
        || /^\\(python|cpp)display(?:\{[^}]*\})?$/i.exec(value);
      if (codeOpen) {
        const kind = value.match(/^\\(python|cpp)display/i)
          ? `${codeOpen[1].toLowerCase()}display`
          : codeOpen[1].toLowerCase();
        open(kind, line);
        continue;
      }

      if (value === '\\begin{itemize}' || value === '\\begin{enumerate}') {
        if (current()?.kind === 'list') report(line, 'Nested lists are not supported. Close the list opened above before starting another one.', 'invalid-nesting');
        open('list', line);
        continue;
      }
      if (value === '\\end{itemize}' || value === '\\end{enumerate}') {
        close('list', line, value.slice(1));
        continue;
      }
      if (value.startsWith('\\questiongroup{')) {
        if (group) report(line, `Nested \\questiongroup is not valid. Close the group opened at line ${group.line} first.`, 'invalid-nesting');
        if (question) report(line, `A \\question is still open from line ${question.line}. Close it before starting a new question group.`, 'invalid-nesting');
        group = { line, seen: new Map() };
        open('questiongroup', line);
        continue;
      }
      if (value === '\\endquestiongroup') {
        if (question) report(line, `\\question opened at line ${question.line} must end before \\endquestiongroup.`, 'invalid-nesting');
        if (close('questiongroup', line, 'endquestiongroup')) group = null;
        continue;
      }
      if (value.startsWith('\\question{')) {
        if (!group) report(line, '\\question must be inside a \\questiongroup.', 'invalid-nesting');
        if (question) report(line, `A \\question is already open from line ${question.line}. Close it before starting another question.`, 'invalid-nesting');
        question = { line, seen: new Map(), scoreTypes: new Map() };
        open('question', line);
        continue;
      }
      if (value === '\\endquestion') {
        if (ai) report(line, `\\ai opened at line ${ai.line} must end before \\endquestion.`, 'invalid-nesting');
        if (close('question', line, 'endquestion')) question = null;
        continue;
      }
      if (value.startsWith('\\multiplechoice{')) {
        if (!question) report(line, '\\multiplechoice must be inside a \\question.', 'invalid-nesting');
        else markOnce(question.seen, 'multiplechoice', line, 'question');
        open('multiplechoice', line);
        continue;
      }
      if (value === '\\endmultiplechoice') {
        close('multiplechoice', line, 'endmultiplechoice');
        continue;
      }
      if (value.startsWith('\\ai{')) {
        if (!group) report(line, '\\ai must be inside a \\questiongroup.', 'invalid-nesting');
        if (ai) report(line, `An \\ai block is already open from line ${ai.line}. Close it before starting another one.`, 'invalid-nesting');
        ai = { line, seen: new Map() };
        open('ai', line);
        continue;
      }
      if (value === '\\endai') {
        if (close('ai', line, 'endai')) ai = null;
        continue;
      }
      const score = /^\\score\{\s*\d+\s*,\s*([^}\s]+)\s*\}$/i.exec(value);
      if (score) {
        if (!question) report(line, '\\score must be inside a \\question.', 'invalid-nesting');
        else markOnce(question.scoreTypes, `score{${score[1].toLowerCase()}}`, line, 'question');
        open('score', line);
        continue;
      }
      const file = /^\\file\{/.test(value);
      if (file) { open('file', line); continue; }

      const command = /^\\([A-Za-z]+)(?:\{|$)/.exec(value);
      const tag = command?.[1]?.toLowerCase();
      if (!tag) continue;
      if (ROOT_SINGLETONS.has(tag)) {
        markOnce(seenRoot, tag, line, 'activity');
      } else if (tag === 'retries') {
        if (question) report(line, '\\retries belongs to an activity or question group, not inside a \\question.', 'invalid-nesting');
        else if (group) markOnce(group.seen, tag, line, 'question group');
        else markOnce(seenRoot, tag, line, 'activity');
      } else if (QUESTION_SINGLETONS.has(tag)) {
        if (!question) report(line, `\\${tag} must be inside a \\question.`, 'invalid-nesting');
        else markOnce(question.seen, tag, line, 'question');
      } else if (AI_SINGLETONS.has(tag)) {
        if (!ai) report(line, `\\${tag} must be inside an \\ai block.`, 'invalid-nesting');
        else markOnce(ai.seen, tag, line, 'AI block');
      } else if (tag === 'choice' && current()?.kind !== 'multiplechoice') {
        report(line, '\\choice must be inside a \\multiplechoice block.', 'invalid-nesting');
      }
    }

    for (const item of stack.slice().reverse()) {
      // Code blocks advertise the CANONICAL closer for their family, so the fix
      // we suggest is the form we want written from now on.
      const end = canonicalCloserFor(item.kind) || {
        questiongroup: '\\endquestiongroup', question: '\\endquestion', multiplechoice: '\\endmultiplechoice',
        ai: '\\endai', score: '\\endscore', file: '\\endfile', list: '\\end{itemize} or \\end{enumerate}',
      }[item.kind] || 'a matching end tag';
      report(item.line, `Unclosed ${item.kind} block. Add ${end}.`, 'unclosed-block');
    }
    return { valid: issues.length === 0, issues };
  }

  return { validateActivityMarkup };
}));
