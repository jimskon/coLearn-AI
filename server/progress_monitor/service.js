const db = require('../db');
const aiController = require('../ai/controller');

const SUGGESTION_STATUSES = new Set([
  'needs_check_in',
  'stuck_after_feedback',
  'falling_behind',
]);

const DEFAULT_DEBOUNCE_MS = Number(process.env.PROGRESS_MONITOR_SUGGESTION_DEBOUNCE_MINUTES || 10) * 60 * 1000;

const inFlightByInstance = new Map();

function cleanId(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Math.floor(Number(ms) || 0));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeHistoryQid(qidRaw) {
  const qid = String(qidRaw || '').trim();
  if (!qid) return null;

  if (/^attempt:\d+$/i.test(qid)) return null;
  if (/^\d+state$/i.test(qid)) return null;
  if (/^R(?:cnt|max|hash):\d+$/i.test(qid)) return null;
  if (/^test(?:Total|Max|Summary)Score$/i.test(qid)) return null;

  const suffixPatterns = [
    /^(?<base>\d+[A-Za-z]+)F\d+$/i,
    /^(?<base>\d+[A-Za-z]+)FA\d+$/i,
    /^(?<base>\d+[A-Za-z]+)FM$/i,
    /^(?<base>\d+[A-Za-z]+)AF$/i,
    /^(?<base>\d+[A-Za-z]+)S$/i,
    /^(?<base>\d+[A-Za-z]+)CodeFeedback$/i,
    /^(?<base>\d+[A-Za-z]+)RunFeedback$/i,
    /^(?<base>\d+[A-Za-z]+)ResponseFeedback$/i,
    /^(?<base>\d+[A-Za-z]+)CodeScore$/i,
    /^(?<base>\d+[A-Za-z]+)RunScore$/i,
    /^(?<base>\d+[A-Za-z]+)ResponseScore$/i,
    /^(?<base>\d+[A-Za-z]+)CodeAccepted$/i,
    /^(?<base>\d+[A-Za-z]+)CodeCanContinue$/i,
    /^(?<base>\d+[A-Za-z]+)CodeRetryCount$/i,
    /^(?<base>\d+[A-Za-z]+)CodeRetriesRequired$/i,
    /^(?<base>\d+[A-Za-z]+)CodeSubmissionString$/i,
    /^(?<base>\d+[A-Za-z]+)(?:Output|output\d*|code\d+|table\d+cell\d+_\d+)$/i,
  ];

  for (const pattern of suffixPatterns) {
    const match = qid.match(pattern);
    if (match?.groups?.base) return match.groups.base;
  }

  if (/^\d+[A-Za-z]+$/i.test(qid)) return qid;
  return null;
}

function sanitizeSuggestionText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  if (value.length > 140) return value.slice(0, 137).trimEnd() + '...';

  const blockedPatterns = [
    /\bthe answer is\b/i,
    /\bcorrect answer\b/i,
    /\bsolution\b/i,
    /\breveal\b/i,
    /\bfinal answer\b/i,
    /\bwrite\b.*\banswer\b/i,
    /\buse\b.*\banswer\b/i,
  ];

  if (blockedPatterns.some((pattern) => pattern.test(value))) {
    return null;
  }

  if (!/^(ask|give|prompt|remind|have|point|encourage|tell|nudge)/i.test(value)) {
    return null;
  }

  return value;
}

async function getLatestProgressChange(instanceId) {
  const [[row]] = await db.query(
    `SELECT id, created_at, details
       FROM audit_log
      WHERE activity_instance_id = ?
        AND event_type = 'progress_status_change'
      ORDER BY id DESC
      LIMIT 1`,
    [instanceId]
  );

  const details = parseJson(row?.details);
  return row
    ? {
        id: Number(row.id),
        createdAt: row.created_at || null,
        details,
      }
    : null;
}

async function getLatestSuggestion(instanceId) {
  const [[row]] = await db.query(
    `SELECT id, activity_instance_id, audit_log_id, previous_status, status, suggestion_text,
            suggestion_state, generated_at, dismissed_at, acted_on_at, updated_at
       FROM progress_monitor_suggestions
      WHERE activity_instance_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [instanceId]
  );

  return row || null;
}

function shouldGenerateSuggestion(status, latestSuggestion, nowMs = Date.now()) {
  if (!SUGGESTION_STATUSES.has(normalizeStatus(status))) {
    return { allowed: false, reason: 'status_not_qualifying' };
  }

  if (!latestSuggestion?.generated_at) {
    return { allowed: true, reason: null };
  }

  const generatedAt = new Date(latestSuggestion.generated_at).getTime();
  if (Number.isFinite(generatedAt) && nowMs - generatedAt < DEFAULT_DEBOUNCE_MS) {
    return { allowed: false, reason: 'debounced' };
  }

  return { allowed: true, reason: null };
}

async function getCurrentQuestionBaseQid(instanceId) {
  const [rows] = await db.query(
    `SELECT question_id
       FROM responses
      WHERE activity_instance_id = ?
      ORDER BY id DESC`,
    [instanceId]
  );

  for (const row of rows || []) {
    const baseQid = normalizeHistoryQid(row.question_id);
    if (baseQid) return baseQid;
  }

  return null;
}

async function buildSuggestionContext({ instanceId, newStatus, previousStatus, statusAgeMs }) {
  const [instanceRows] = await db.query(
    `SELECT ai.id, ai.activity_id, ai.course_id, ai.group_number, ai.progress_status,
            a.title AS activity_title, a.name AS activity_name,
            c.name AS course_name, c.code AS course_code, c.section, c.semester, c.year
       FROM activity_instances ai
       JOIN pogil_activities a ON a.id = ai.activity_id
       JOIN courses c ON c.id = ai.course_id
      WHERE ai.id = ?`,
    [instanceId]
  );
  const instance = instanceRows?.[0] || null;

  const [memberRows] = await db.query(
    `SELECT gm.role, gm.connected, gm.last_heartbeat, u.name, u.email
       FROM group_members gm
       JOIN users u ON u.id = gm.student_id
      WHERE gm.activity_instance_id = ?
      ORDER BY gm.id ASC`,
    [instanceId]
  );

  const [eventRows] = await db.query(
    `SELECT created_at, details
       FROM audit_log
      WHERE activity_instance_id = ?
        AND event_type = 'progress_status_change'
      ORDER BY id DESC
      LIMIT 1`,
    [instanceId]
  );
  const latestEvent = eventRows?.[0] || null;
  const latestEventDetails = parseJson(latestEvent?.details) || {};
  const timeInStatusMs = Number.isFinite(Number(statusAgeMs))
    ? Number(statusAgeMs)
    : (latestEvent?.created_at ? Math.max(0, Date.now() - new Date(latestEvent.created_at).getTime()) : null);

  const currentQid = await getCurrentQuestionBaseQid(instanceId);
  const attemptHistory = currentQid
    ? await aiController.buildAttemptHistoryContext({ instanceId, qid: currentQid, limit: 3 })
    : '';

  const [feedbackRows] = await db.query(
    `SELECT f.id, f.feedback_text, f.generated_at, r.question_id
       FROM feedback f
       LEFT JOIN responses r ON r.id = f.response_id
      WHERE r.activity_instance_id = ?
      ORDER BY f.id DESC
      LIMIT 3`,
    [instanceId]
  );

  const [followupRows] = await db.query(
    `SELECT fu.id, fu.followup_prompt, fu.followup_generated, fu.generated_at, r.question_id
       FROM followups fu
       LEFT JOIN responses r ON r.id = fu.response_id
      WHERE r.activity_instance_id = ?
      ORDER BY fu.id DESC
      LIMIT 3`,
    [instanceId]
  );

  const feedbackHistory = [
    ...feedbackRows.map((row) => `Feedback ${row.id}: ${String(row.feedback_text || '').trim()}`),
    ...followupRows.map((row) => `Follow-up ${row.id}: ${String(row.followup_generated || '').trim()}`),
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  const recentResponseSummary = currentQid
    ? `Current question base id: ${currentQid}\n` +
      `Recent attempts:\n${attemptHistory || '(none yet)'}`
    : 'No prior response attempts were found for this group.';

  const statusLabel = normalizeStatus(newStatus);
  const statusAgeLabel = timeInStatusMs == null ? 'unknown' : formatDuration(timeInStatusMs);

  return {
    instance,
    memberRows,
    latestEventDetails,
    currentQid,
    recentResponseSummary,
    feedbackHistory,
    statusLabel,
    previousStatus: normalizeStatus(previousStatus) || null,
    timeInStatusMs,
    timeInStatusLabel: statusAgeLabel,
  };
}

async function persistSuggestion({
  instanceId,
  auditLogId,
  previousStatus,
  status,
  suggestionText,
  context,
}) {
  const contextJson = JSON.stringify(context || {});
  const [result] = await db.query(
    `INSERT INTO progress_monitor_suggestions
       (activity_instance_id, audit_log_id, previous_status, status, suggestion_text, context_json, suggestion_state)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [
      instanceId,
      auditLogId ?? null,
      previousStatus || null,
      status,
      suggestionText,
      contextJson,
    ]
  );

  const [[row]] = await db.query(
    `SELECT id, activity_instance_id, audit_log_id, previous_status, status, suggestion_text,
            suggestion_state, generated_at, dismissed_at, acted_on_at, updated_at
       FROM progress_monitor_suggestions
      WHERE id = ?`,
    [result.insertId]
  );

  return row || null;
}

function emitSuggestionUpdate(row, extra = {}) {
  if (!row) return;
  const payload = {
    suggestionId: Number(row.id),
    activityInstanceId: Number(row.activity_instance_id),
    auditLogId: row.audit_log_id == null ? null : Number(row.audit_log_id),
    previousStatus: normalizeStatus(row.previous_status) || null,
    status: normalizeStatus(row.status) || null,
    suggestionText: row.suggestion_text || null,
    suggestionState: row.suggestion_state || null,
    generatedAt: row.generated_at || null,
    dismissedAt: row.dismissed_at || null,
    actedOnAt: row.acted_on_at || null,
    ...extra,
  };

  db.query(
    'SELECT course_id, activity_id FROM activity_instances WHERE id = ?',
    [row.activity_instance_id]
  ).then(([rows]) => {
    const instance = rows?.[0];
    if (!instance) return;
    if (instance.course_id != null) {
      global.io?.to(`progress-monitor-course-${instance.course_id}`).emit('progress:suggestion', payload);
    }
    if (instance.activity_id != null) {
      global.io?.to(`progress-monitor-activity-${instance.activity_id}`).emit('progress:suggestion', payload);
    }
  }).catch((err) => {
    console.warn('[progress-monitor] failed to emit suggestion update', err?.message || err);
  });
}

async function generateSuggestionText(context) {
  const callLLMJsonStrict = aiController.callLLMJsonStrict;
  const result = await callLLMJsonStrict({
    allowedKeys: ['suggestion'],
    temperature: 0.2,
    max_tokens: 120,
    messages: [
      {
        role: 'system',
        content: [
          'You are an instructor-side facilitator assistant for a collaborative learning activity.',
          'Rules already decided that this group needs attention. Do not reclassify the group.',
          'Do not solve the activity or generate the answer.',
          'Do not restate the group response.',
          'Produce exactly one short concrete instructor/facilitator action.',
          'Keep the suggestion to 6-14 words when possible.',
          'Use the group response and feedback history only as context for what to suggest next.',
          'Examples: Ask the facilitator to restate the goal. Ask the analyst what changed after the last attempt. Give a time warning.',
          'If the group is stuck after feedback, ask for a reflection on the last hint.',
          'If the group is falling behind, prefer a pacing or time warning.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Status: ${context.statusLabel}`,
          context.previousStatus ? `Previous status: ${context.previousStatus}` : '',
          `Time in status: ${context.timeInStatusLabel}`,
          context.instance?.course_name ? `Course: ${context.instance.course_name}` : '',
          context.instance?.activity_title || context.instance?.activity_name
            ? `Activity: ${context.instance.activity_title || context.instance.activity_name}`
            : '',
          context.instance?.group_number != null ? `Group number: ${context.instance.group_number}` : '',
          context.instance?.course_code ? `Course code: ${context.instance.course_code}` : '',
          context.memberRows?.length
            ? `Group members: ${context.memberRows.map((member) => `${member.name}${member.role ? ` (${member.role})` : ''}`).join(', ')}`
            : '',
          'Recent response history:',
          context.recentResponseSummary,
          context.feedbackHistory ? `Existing feedback/followups:\n${context.feedbackHistory}` : 'Existing feedback/followups: none',
          'Write one short instructor action only. Do not include the answer, a worked solution, or a restatement of the student response.',
          'Return JSON only: {"suggestion":"..."}',
        ].filter(Boolean).join('\n\n'),
      },
    ],
  });

  return sanitizeSuggestionText(result?.suggestion);
}

async function enqueueSuggestionForStatusChange({
  instanceId,
  auditLogId = null,
  previousStatus = null,
  newStatus,
  statusAgeMs = null,
}) {
  const numericInstanceId = cleanId(instanceId);
  const normalizedStatus = normalizeStatus(newStatus);
  if (!numericInstanceId || !SUGGESTION_STATUSES.has(normalizedStatus)) {
    return null;
  }

  const lockKey = `${numericInstanceId}:${normalizedStatus}`;
  const existing = inFlightByInstance.get(lockKey);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    const latestSuggestion = await getLatestSuggestion(numericInstanceId);
    const gate = shouldGenerateSuggestion(normalizedStatus, latestSuggestion);
    if (!gate.allowed) {
      return null;
    }

    const context = await buildSuggestionContext({
      instanceId: numericInstanceId,
      newStatus: normalizedStatus,
      previousStatus,
      statusAgeMs,
    });

    const suggestionText = await generateSuggestionText(context);
    if (!suggestionText) {
      return null;
    }

    const row = await persistSuggestion({
      instanceId: numericInstanceId,
      auditLogId,
      previousStatus,
      status: normalizedStatus,
      suggestionText,
      context,
    });

    emitSuggestionUpdate(row);
    return row;
  })()
    .catch((err) => {
      console.error('[progress-monitor] suggestion generation failed', err?.message || err);
      return null;
    })
    .finally(() => {
      inFlightByInstance.delete(lockKey);
    });

  inFlightByInstance.set(lockKey, task);
  return task;
}

async function updateSuggestionState({ suggestionId, state }) {
  const numericSuggestionId = cleanId(suggestionId);
  const normalizedState = String(state || '').trim().toLowerCase();
  if (!numericSuggestionId || !['dismissed', 'acted_on'].includes(normalizedState)) {
    return null;
  }

  const [[current]] = await db.query(
    `SELECT id, activity_instance_id, audit_log_id, previous_status, status, suggestion_text,
            suggestion_state, generated_at, dismissed_at, acted_on_at, updated_at
       FROM progress_monitor_suggestions
      WHERE id = ?`,
    [numericSuggestionId]
  );

  if (!current) {
    return null;
  }

  if (current.suggestion_state === normalizedState) {
    return current;
  }

  const now = new Date();
  const updateFields = [];
  const params = [];
  if (normalizedState === 'dismissed') {
    updateFields.push('suggestion_state = ?');
    params.push('dismissed');
    updateFields.push('dismissed_at = ?');
    params.push(now);
  } else if (normalizedState === 'acted_on') {
    updateFields.push('suggestion_state = ?');
    params.push('acted_on');
    updateFields.push('acted_on_at = ?');
    params.push(now);
  }
  updateFields.push('updated_at = ?');
  params.push(now);
  params.push(numericSuggestionId);

  await db.query(
    `UPDATE progress_monitor_suggestions
        SET ${updateFields.join(', ')}
      WHERE id = ?`,
    params
  );

  const [[row]] = await db.query(
    `SELECT id, activity_instance_id, audit_log_id, previous_status, status, suggestion_text,
            suggestion_state, generated_at, dismissed_at, acted_on_at, updated_at
       FROM progress_monitor_suggestions
      WHERE id = ?`,
    [numericSuggestionId]
  );

  emitSuggestionUpdate(row, { updated: true });
  return row || null;
}

module.exports = {
  enqueueSuggestionForStatusChange,
  updateSuggestionState,
  sanitizeSuggestionText,
  shouldGenerateSuggestion,
};
