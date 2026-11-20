'use strict';

// Survey results (\mode{survey}).
//
// A survey runs like an assignment: each student answers in their own
// instance and the answers are saved in `responses` as usual. Anonymity is
// enforced here, on the way out: results list respondents in random order with
// no names or ids, and the completion list shows who submitted but never what
// they answered. The AI summary is built from the anonymous results only.

const db = require('../db');
const { loadActivitySourceLines } = require('../utils/activityContent');
const { inferAuthoredModeFromLines } = require('../utils/activityType');
const { accessibleCourseIds } = require('../research/access');
const { recordAuditEvent } = require('../utils/auditLogger');
const { requestJsonGrade } = require('../ai/grading');

const SUMMARY_EVENT = 'survey_ai_summary';
const SUMMARY_TOKENS = Number(process.env.SURVEY_SUMMARY_TOKENS) || 4000;
const MAX_DIGEST_CHARS = 60000;

// Keys the submit step writes for grading, not answers.
const NON_ANSWER_KEY = /(CodeScore|CodeFeedback|RunScore|RunFeedback|ResponseScore|ResponseFeedback|AiTokens)$|^test(TotalScore|MaxScore|Summary)$/;

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Checks access and loads what every survey request needs.
async function loadScope(req, res) {
  const courseId = Number(req.params.courseId);
  const activityId = Number(req.params.activityId);
  const scope = req.query.scope === 'class' || req.body?.scope === 'class' ? 'class' : 'course';
  if (!req.user) {
    res.status(401).json({ error: 'Please log in.' });
    return null;
  }
  if (!(courseId > 0) || !(activityId > 0)) {
    res.status(400).json({ error: 'Invalid course or activity' });
    return null;
  }
  const allowed = new Set(await accessibleCourseIds(db, req.user));
  if (!allowed.has(courseId)) {
    res.status(403).json({ error: 'Only the course instructor can see survey results.' });
    return null;
  }

  const [[activity]] = await db.query(
    `SELECT id, title, class_id, sheet_url, source_type, content_text
       FROM pogil_activities WHERE id = ?`,
    [activityId]
  );
  if (!activity) {
    res.status(404).json({ error: 'Activity not found' });
    return null;
  }
  const lines = await loadActivitySourceLines(activity);
  if (inferAuthoredModeFromLines(lines) !== 'survey') {
    res.status(400).json({ error: 'This activity is not a survey.' });
    return null;
  }

  let courses;
  if (scope === 'class') {
    const [rows] = await db.query(
      'SELECT id, name FROM courses WHERE class_id = ? ORDER BY id',
      [activity.class_id]
    );
    courses = rows.filter((c) => allowed.has(c.id));
  } else {
    const [rows] = await db.query('SELECT id, name FROM courses WHERE id = ?', [courseId]);
    courses = rows;
  }
  return { courseId, activityId, scope, activity, lines, courses };
}

async function savedSummary(ctx) {
  const [[row]] = await db.query(
    `SELECT details FROM audit_log
      WHERE event_type = ? AND course_id = ? AND activity_id = ?
      ORDER BY id DESC LIMIT 1`,
    [`${SUMMARY_EVENT}:${ctx.scope}`, ctx.courseId, ctx.activityId]
  );
  if (!row) return null;
  try {
    return JSON.parse(row.details);
  } catch {
    return null;
  }
}

// GET /api/activity-instances/survey-results/:courseId/:activityId?scope=course|class
async function getSurveyResults(req, res) {
  try {
    const ctx = await loadScope(req, res);
    if (!ctx) return;
    const courseIds = ctx.courses.map((c) => c.id);
    if (!courseIds.length) {
      return res.json({ activityTitle: ctx.activity.title, scope: ctx.scope, courses: [], lines: ctx.lines, completion: [], respondents: [], ai: null });
    }

    // Completion: every enrolled student and whether they submitted.
    const [students] = await db.query(
      `SELECT ce.course_id, u.id AS user_id, u.name, u.email
         FROM course_enrollments ce
         JOIN users u ON u.id = ce.student_id
        WHERE ce.course_id IN (?) AND u.role = 'student'
        ORDER BY u.name`,
      [courseIds]
    );
    const [instances] = await db.query(
      `SELECT ai.id, ai.course_id, ai.submitted_at, gm.student_id
         FROM activity_instances ai
         JOIN group_members gm ON gm.activity_instance_id = ai.id
        WHERE ai.activity_id = ? AND ai.course_id IN (?)`,
      [ctx.activityId, courseIds]
    );
    const byStudent = new Map();
    for (const i of instances) byStudent.set(`${i.course_id}:${i.student_id}`, i);
    const courseName = new Map(ctx.courses.map((c) => [c.id, c.name]));
    const completion = students.map((s) => {
      const inst = byStudent.get(`${s.course_id}:${s.user_id}`);
      return {
        name: s.name,
        email: s.email,
        course: courseName.get(s.course_id) || '',
        status: inst?.submitted_at ? 'submitted' : inst ? 'started' : 'not started',
      };
    });

    // Answers from submitted instances only: the latest value of each key,
    // with no instance or student ids, in random order.
    // Only enrolled students' instances count (not an instructor's sandbox).
    const enrolled = new Set(students.map((s) => `${s.course_id}:${s.user_id}`));
    const submittedIds = [...new Set(instances
      .filter((i) => i.submitted_at && enrolled.has(`${i.course_id}:${i.student_id}`))
      .map((i) => i.id))];
    let respondents = [];
    if (submittedIds.length) {
      const [rows] = await db.query(
        `SELECT activity_instance_id, question_id, response
           FROM responses
          WHERE activity_instance_id IN (?)
          ORDER BY id`,
        [submittedIds]
      );
      const answers = new Map(submittedIds.map((id) => [id, {}]));
      for (const r of rows) {
        if (NON_ANSWER_KEY.test(r.question_id)) continue;
        answers.get(r.activity_instance_id)[r.question_id] = String(r.response ?? '');
      }
      respondents = shuffle([...answers.values()]);
    }

    return res.json({
      activityTitle: ctx.activity.title,
      scope: ctx.scope,
      courses: ctx.courses,
      lines: ctx.lines,
      completion,
      respondents,
      ai: await savedSummary(ctx),
    });
  } catch (err) {
    console.error('❌ survey results:', err);
    return res.status(500).json({ error: 'Could not load survey results.' });
  }
}

// POST /api/activity-instances/survey-results/:courseId/:activityId/ai
// body: { scope, digest } where digest is the anonymous results as text
// (questions, choice counts, text answers) built by the results page.
async function generateSurveySummary(req, res) {
  try {
    const ctx = await loadScope(req, res);
    if (!ctx) return;
    let digest = String(req.body?.digest || '').trim();
    if (!digest) return res.status(400).json({ error: 'There are no responses to summarize.' });
    if (digest.length > MAX_DIGEST_CHARS) digest = `${digest.slice(0, MAX_DIGEST_CHARS)}\n…(truncated)`;

    const messages = [
      {
        role: 'system',
        content: [
          'You summarize anonymous course survey results for an instructor.',
          'Base every statement on the results given. Do not guess who wrote anything, and do not quote an answer in a way that could identify its author.',
          'For each question, describe the main patterns: for choices, what most people picked and anything notable; for written answers, the main themes and any notable minority views.',
          'Be concrete and brief. Name questions by their id (for example 2a).',
          'Return JSON: {"overview": string, "questions": [{"question": string, "summary": string}], "takeaways": [string]}.',
        ].join(' '),
      },
      { role: 'user', content: `Survey: ${ctx.activity.title}\n\n${digest}` },
    ];
    const result = await requestJsonGrade(messages, SUMMARY_TOKENS, {
      setting: 'SURVEY_SUMMARY_TOKENS',
      where: 'survey summary',
    });
    const saved = {
      generatedAt: new Date().toISOString(),
      scope: ctx.scope,
      respondents: Number(req.body?.respondents) || null,
      overview: String(result?.overview || ''),
      questions: Array.isArray(result?.questions) ? result.questions : [],
      takeaways: Array.isArray(result?.takeaways) ? result.takeaways.map(String) : [],
    };
    await recordAuditEvent(`${SUMMARY_EVENT}:${ctx.scope}`, {
      req,
      courseId: ctx.courseId,
      activityId: ctx.activityId,
      details: saved,
    });
    return res.json(saved);
  } catch (err) {
    console.error('❌ survey summary:', err);
    const status = err?.code === 'AI_TOKEN_LIMIT' ? 503 : 500;
    return res.status(status).json({ error: err?.message || 'Could not summarize the survey.' });
  }
}

module.exports = { getSurveyResults, generateSurveySummary };
