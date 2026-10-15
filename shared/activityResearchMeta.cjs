/*
 * Activity facts needed for research statistics, read from activity markup.
 *
 * Question ids follow client/src/utils/parseSheet.jsx exactly: the question
 * group number (1-based, counted across the whole activity) followed by a
 * letter per \question within that group ("2b"). The response trace stores
 * answers under these ids, so this numbering must not drift from the parser.
 *
 * Plain CommonJS with no dependencies beyond the grammar, so the server and
 * tests can use it directly.
 */
const grammar = require('./activityGrammar.cjs');

const QUESTION_TYPES = new Set(grammar.ENUMS.questiontype);

function braceArgs(line) {
  const args = [];
  const re = /\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(line))) args.push(match[1]);
  return args;
}

/**
 * @param {string[]|string} source  activity markup (lines or text)
 * @returns {{
 *   questions: Map<string, {qid, groupNum, letter, sectionIndex, questionType, hasCode, isSurvey}>,
 *   groups: Array<{groupNum, sectionIndex}>,
 *   sections: Array<{index, title, minutes}>,
 *   plannedMinutes: number|null,
 * }}
 */
function extractActivityResearchMeta(source) {
  const lines = Array.isArray(source) ? source : String(source || '').split(/\r?\n/);

  const questions = new Map();
  const groups = [];
  const sections = [];
  let groupNum = 0;
  let letterCode = 97;
  let sectionIndex = null;
  let current = null; // question being read
  let mc = null; // { correct, scored } for the current \multiplechoice

  const finishQuestion = () => {
    if (!current) return;
    current.isSurvey = !!mc && !mc.correct && !mc.scored && mc.choices >= 2;
    questions.set(current.qid, current);
    current = null;
    mc = null;
  };

  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line.startsWith('\\')) continue;

    if (/^\\section\*?\{/.test(line)) {
      const [title = '', minutes] = braceArgs(line);
      const parsed = Number(String(minutes ?? '').trim());
      sections.push({
        index: sections.length,
        title: title.trim(),
        minutes: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      });
      sectionIndex = sections.length - 1;
      continue;
    }

    // Check \questiongroup and \questiontype before \question: all share a prefix.
    if (/^\\questiongroup\b/.test(line)) {
      finishQuestion();
      groupNum += 1;
      letterCode = 97;
      groups.push({ groupNum, sectionIndex });
      continue;
    }

    if (/^\\questiontype\{/.test(line)) {
      const value = String(braceArgs(line)[0] || '').trim().toLowerCase();
      if (current && QUESTION_TYPES.has(value)) current.questionType = value;
      continue;
    }

    if (/^\\question\{/.test(line)) {
      finishQuestion();
      const letter = String.fromCharCode(letterCode);
      letterCode += 1;
      current = {
        qid: `${groupNum}${letter}`,
        groupNum,
        letter,
        sectionIndex,
        questionType: 'unknown',
        hasCode: false,
        isSurvey: false,
      };
      continue;
    }

    if (/^\\endquestion\b/.test(line)) {
      finishQuestion();
      continue;
    }

    if (!current) continue;

    if (grammar.isCodeOpenLine(line)) {
      current.hasCode = true;
      continue;
    }

    if (/^\\multiplechoice\{/.test(line)) {
      const value = String(braceArgs(line)[0] || '').trim();
      // \multiplechoice{multiple} is an ungraded select-all survey, not an answer key.
      mc = { correct: value.toLowerCase() === 'multiple' ? '' : value, scored: false, choices: 0 };
      continue;
    }

    if (mc && /^\\choice\{/.test(line)) {
      mc.choices += 1;
      if (braceArgs(line).length >= 2) mc.scored = true;
    }
  }
  finishQuestion();

  const timed = sections.filter((s) => s.minutes != null);
  return {
    questions,
    groups,
    sections,
    plannedMinutes: timed.length ? timed.reduce((sum, s) => sum + s.minutes, 0) : null,
  };
}

module.exports = { extractActivityResearchMeta, QUESTION_TYPES };
