'use strict';

// Pure aggregation for the root Statistics page. The route gathers plain rows
// from group_members and responses; everything here is DB-free so it can be
// unit-tested.
//
// What the rows mean (see activity_instances/controller.js submitGroupResponses):
// - A base answer key such as "1a" is appended only when its text changed, so
//   the number of "1a" rows is the number of submitted versions.
// - Every group submit click appends one "<groupNum>state" row
//   ('complete' = the group advanced) and one "attempt:<groupNum>" row whose
//   JSON records forceOverride (the explicit Continue button) and unanswered.
// - "<qid>FM" holds the AI decision for a question: 'accepted' or 'needsRevision'.

const BASE_QID = /^\d+[a-z]{1,2}$/; // derived keys use uppercase suffixes (1aS, 1aFM)
const FM_QID = /^(\d+[a-z]{1,2})FM$/;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function pct(part, whole) {
  return whole ? round((100 * part) / whole, 1) : null;
}

// Normalized Shannon entropy of submit counts across group members:
// 1 = every member submitted equally often, 0 = one member submitted everything.
function balanceIndex(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (counts.length < 2 || total === 0) return null;
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log(p);
    }
  }
  return h / Math.log(counts.length);
}

function summarize({
  instances = [],
  members = [],
  answerKeys = [],
  fmRows = [],
  states = [],
  attempts = [],
  enrolledStudentIds = [],
} = {}) {
  // Only instances that actually had a group count as groups.
  const membersByInstance = new Map();
  for (const m of members) {
    if (!membersByInstance.has(m.instanceId)) membersByInstance.set(m.instanceId, new Set());
    membersByInstance.get(m.instanceId).add(m.studentId);
  }
  const groupInstances = instances.filter((i) => membersByInstance.has(i.id));
  const inScope = new Set(groupInstances.map((i) => i.id));

  const participating = new Set();
  for (const id of inScope) {
    for (const s of membersByInstance.get(id)) participating.add(s);
  }
  const groupSizes = groupInstances.map((i) => membersByInstance.get(i.id).size);

  // ---- Revisions per question ----
  const versionCounts = answerKeys
    .filter((r) => inScope.has(r.instanceId) && BASE_QID.test(String(r.questionId)))
    .map((r) => Number(r.n) || 0)
    .filter((n) => n > 0);

  // ---- AI decisions per question ----
  const decisions = new Map(); // "instance|qid" -> sent back at least once?
  for (const r of fmRows) {
    if (!inScope.has(r.instanceId)) continue;
    const match = FM_QID.exec(String(r.questionId));
    if (!match) continue;
    const key = `${r.instanceId}|${match[1]}`;
    const sentBack = String(r.response || '').trim() === 'needsRevision';
    decisions.set(key, Boolean(decisions.get(key)) || sentBack);
  }
  const questionsSentBack = [...decisions.values()].filter(Boolean).length;

  // ---- Group submits ----
  const attemptBySubmit = new Map();
  for (const a of attempts) attemptBySubmit.set(a.submitId, parseJson(a.response) || {});

  let advanced = 0;
  let advancedViaContinue = 0;
  let heldBackByAI = 0;
  let incomplete = 0;
  const submitsByInstance = new Map();

  for (const s of states) {
    if (!inScope.has(s.instanceId)) continue;
    const attempt = attemptBySubmit.get(s.submitId) || {};
    const done = String(s.response || '').trim().toLowerCase() === 'complete';
    const unanswered = Array.isArray(attempt.unanswered) ? attempt.unanswered : [];

    if (done) {
      advanced += 1;
      if (attempt.forceOverride) advancedViaContinue += 1;
    } else if (unanswered.length > 0) {
      incomplete += 1;
    } else {
      heldBackByAI += 1;
    }

    if (!submitsByInstance.has(s.instanceId)) submitsByInstance.set(s.instanceId, new Map());
    const byUser = submitsByInstance.get(s.instanceId);
    byUser.set(s.userId, (byUser.get(s.userId) || 0) + 1);
  }
  const groupSubmits = advanced + heldBackByAI + incomplete;

  // ---- Participation evenness (groups of 2+ with at least one submit) ----
  const balances = [];
  const topShares = [];
  let membersCounted = 0;
  let membersWhoSubmitted = 0;
  for (const id of inScope) {
    const memberIds = [...membersByInstance.get(id)];
    const byUser = submitsByInstance.get(id);
    if (memberIds.length < 2 || !byUser) continue;
    const counts = memberIds.map((m) => byUser.get(m) || 0);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    balances.push(balanceIndex(counts));
    topShares.push(Math.max(...counts) / total);
    membersCounted += counts.length;
    membersWhoSubmitted += counts.filter((c) => c > 0).length;
  }

  const topShare = mean(topShares);

  return {
    students: {
      enrolled: new Set(enrolledStudentIds).size,
      participating: participating.size,
    },
    groups: {
      count: groupInstances.length,
      avgSize: round(mean(groupSizes), 1),
    },
    activities: new Set(groupInstances.map((i) => i.activityId)).size,
    revisions: {
      questions: versionCounts.length,
      versions: versionCounts.reduce((a, b) => a + b, 0),
      avgRevisionsPerQuestion: round(mean(versionCounts.map((n) => n - 1))),
      pctQuestionsRevised: pct(versionCounts.filter((n) => n > 1).length, versionCounts.length),
    },
    participation: {
      groupsMeasured: balances.length,
      avgBalance: round(mean(balances)),
      avgTopSubmitterSharePct: topShare == null ? null : round(100 * topShare, 1),
      pctMembersWhoSubmitted: pct(membersWhoSubmitted, membersCounted),
    },
    aiGate: {
      evaluatedQuestions: decisions.size,
      questionsSentBack,
      pctQuestionsSentBack: pct(questionsSentBack, decisions.size),
      groupSubmits,
      advanced,
      advancedViaContinue,
      heldBackByAI,
      pctSubmitsHeldBackByAI: pct(heldBackByAI, groupSubmits),
      incompleteSubmits: incomplete,
    },
  };
}

module.exports = { summarize, balanceIndex };
