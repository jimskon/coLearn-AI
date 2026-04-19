// server/ai/routes.js
const express = require('express');
const router = express.Router();
const {
  evaluateStudentResponse,
  evaluatePythonCode,
  evaluateCode,
  gradeTestQuestionHttp,
  evaluateCppCode,
} = require('./controller');

const code = require('./code');

console.log('AI handlers typeof:', {
  evaluateStudentResponse: typeof evaluateStudentResponse,
  evaluatePythonCode: typeof evaluatePythonCode,
  evaluateCode: typeof evaluateCode,
  gradeTestQuestionHttp: typeof gradeTestQuestionHttp,
  evaluateCppCode: typeof evaluateCppCode,
});

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

router.post('/code/repair-markup', code.repairMarkup);

module.exports = router;
