// server/ai/routes.js
const express = require('express');
const router = express.Router();
const { recordActivity } = require('../research/activityRecorder');

// Research timeline: mark AI evaluation time as "waiting on the system" (not
// idle) at the start and end of each evaluation request.
router.use((req, res, next) => {
  const instanceId = Number(req.body?.instanceId);
  if (req.method === 'POST' && /^\/(evaluate|grade)/.test(req.path) && instanceId > 0) {
    const userId = Number(req.user?.id || req.body?.answeredByUserId);
    recordActivity(instanceId, userId, 'ai_waits');
    res.on('finish', () => recordActivity(instanceId, userId, 'ai_waits'));
  }
  next();
});
const {
  evaluateStudentResponse,
  evaluatePythonCode,
  evaluateCode,
  gradeTestQuestionHttp,
  evaluateCppCode,
  assistInlineActivity,
  assistActivityAi,
} = require('./controller');

const code = require('./code');

console.log('AI handlers typeof:', {
  evaluateStudentResponse: typeof evaluateStudentResponse,
  evaluatePythonCode: typeof evaluatePythonCode,
  evaluateCode: typeof evaluateCode,
  gradeTestQuestionHttp: typeof gradeTestQuestionHttp,
  evaluateCppCode: typeof evaluateCppCode,
});

// Ended - incomplete runs (research/autoEnd.js) may be reviewed, but get no
// more AI evaluation or AI help.
const { rejectIfEnded } = require('../utils/instanceEnded');
async function blockEndedRuns(req, res, next) {
  try {
    if (await rejectIfEnded(req.body?.instanceId, res)) return;
  } catch (err) {
    console.error('❌ ended check:', err);
  }
  next();
}
router.use(['/evaluate-response', '/evaluate-python-code', '/evaluate-code', '/evaluate-cpp-code', '/activity-assist'], blockEndedRuns);

// Short-answer / text evaluation
router.post('/evaluate-response', evaluateStudentResponse);

// Python-only (legacy)
router.post('/evaluate-python-code', evaluatePythonCode);

// Generic code (Python/C++/etc.)
router.post('/evaluate-code', async (req, res) => {
  console.error('[AI!!!!!] /api/ai/evaluate-code');

  const lang = String(req.body?.lang || '').toLowerCase();

  if (lang === 'cpp' || lang === 'c++') {
    return evaluateCppCode(req, res);
  }

  return evaluatePythonCode(req, res);
});

// C++ wrapper (if you’re using it)
router.post('/evaluate-cpp-code', evaluateCppCode);

// ✅ Test-mode grading – calls into controller.js
router.post('/grade-test-question', gradeTestQuestionHttp);
router.post('/assist', assistInlineActivity);
// Persisted, active-student-gated AI help inside a live activity instance.
router.post('/activity-assist', assistActivityAi);

router.post('/code/repair-markup', code.repairMarkup);

module.exports = router;
