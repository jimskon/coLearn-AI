const SUPPORTED_SCORE_TYPES = new Set(['response', 'code', 'output']);

export function normalizeScoreType(rawType = '') {
  return String(rawType || '').trim().toLowerCase();
}

export function isSupportedScoreType(rawType = '') {
  return SUPPORTED_SCORE_TYPES.has(normalizeScoreType(rawType));
}

export function parseScoreCommand(trimmedLine = '') {
  const line = String(trimmedLine || '').trim();
  const match = line.match(/^\\score\{(\d+)\s*,\s*([^}]+?)\}\s*$/i);

  if (!match) {
    return null;
  }

  const points = Number.parseInt(match[1], 10);
  const type = normalizeScoreType(match[2]);

  return {
    points,
    type,
    supported: isSupportedScoreType(type),
  };
}

export function getUnsupportedScoreTypeMessage(scoreTypeRaw = '') {
  const scoreType = normalizeScoreType(scoreTypeRaw);
  if (!scoreType) {
    return 'Unsupported \\score type. Use response, code, or output.';
  }

  if (scoreType === 'choice') {
    return 'Unsupported \\score type "choice". Multiple-choice questions should use \\score{points,response}.';
  }

  return `Unsupported \\score type "${scoreType}". Use response, code, or output.`;
}

export function getMultipleChoiceTestModeIssueMessage({
  isTest,
  hasMultipleChoice,
  correctAnswer,
  hasResponseScore,
  hasChoiceScores,
}) {
  if (!isTest || !hasMultipleChoice) {
    return null;
  }

  const answer = String(correctAnswer || '').trim();
  if (hasChoiceScores) {
    if (hasResponseScore) {
      return 'Multiple-choice questions with per-choice points cannot also use \\score{points,response}. Remove the response score block.';
    }
    return null;
  }

  if (!answer) {
    if (!hasResponseScore) return null;
    return 'A scored multiple-choice question needs per-choice points or a correct answer inside \\multiplechoice{...}.';
  }

  if (!hasResponseScore) {
    return 'Multiple-choice questions in test mode must include an explicit \\score{points,response} rubric block.';
  }

  return null;
}
