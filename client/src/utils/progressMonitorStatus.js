const PROGRESS_STATUS_VALUES = new Set([
  'active_thinking',
  'needs_check_in',
  'stuck_after_feedback',
  'falling_behind',
  'completed',
]);

function toMs(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  const parsed = new Date(value);
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function maxMs(...values) {
  let latest = null;
  for (const value of values) {
    const ms = toMs(value);
    if (ms == null) continue;
    if (latest == null || ms > latest) latest = ms;
  }
  return latest;
}

function median(values = []) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

function isHeartbeatRecent(member, nowMs, presenceWindowMs) {
  const heartbeatMs = toMs(member?.last_heartbeat);
  return heartbeatMs != null && nowMs - heartbeatMs <= presenceWindowMs;
}

export function normalizeStatusValue(rawStatus) {
  const value = String(rawStatus || '').trim().toLowerCase();
  return PROGRESS_STATUS_VALUES.has(value) ? value : 'needs_check_in';
}

export function classifyProgressStatus({
  now = Date.now(),
  activity = null,
  currentTimedSection = null,
  groupMembers = [],
  latestDraftAt = null,
  latestSubmissionAt = null,
  latestFeedbackAt = null,
  submittedQuestionCount = 0,
  currentQuestionCount = 0,
  peerSignals = [],
  progressMonitorConfig = null,
  idleToleranceMinutes = 3,
  recentSubmissionMinutes = 3,
  presenceWindowMinutes = 2,
  majorityElapsedThreshold = 0.5,
  fallingBehindThreshold = 0.8,
  paceLagMinutes = 5,
} = {}) {
  const config = progressMonitorConfig && typeof progressMonitorConfig === 'object' ? progressMonitorConfig : {};
  const resolvedIdleToleranceMinutes = Number(config.idleToleranceMinutes ?? idleToleranceMinutes) || idleToleranceMinutes;
  const resolvedRecentSubmissionMinutes = Number(config.recentSubmissionMinutes ?? recentSubmissionMinutes) || recentSubmissionMinutes;
  const resolvedPresenceWindowMinutes = Number(config.presenceWindowMinutes ?? presenceWindowMinutes) || presenceWindowMinutes;
  const resolvedMajorityElapsedThreshold = Number(config.majorityElapsedThreshold ?? majorityElapsedThreshold) || majorityElapsedThreshold;
  const resolvedFallingBehindThreshold = Number(config.fallingBehindThreshold ?? fallingBehindThreshold) || fallingBehindThreshold;
  const resolvedPaceLagMinutes = Number(config.paceLagMinutes ?? paceLagMinutes) || paceLagMinutes;

  const normalizedProgress = normalizeStatusValue(activity?.progress_status);
  if (normalizedProgress === 'completed') return 'completed';

  const currentSubmittedCount = Number(submittedQuestionCount) || 0;
  const currentQuestionTotal = Number(currentQuestionCount) || 0;
  const sectionCompleted = currentQuestionTotal > 0 && currentSubmittedCount >= currentQuestionTotal;
  if (sectionCompleted) return 'completed';

  const sectionStartedAtMs = toMs(activity?.section_timer_started_at);
  const sectionDurationMinutes = Number(currentTimedSection?.minutes ?? activity?.section_timer_duration_minutes ?? 0);
  const sectionDurationMs = Number.isFinite(sectionDurationMinutes) && sectionDurationMinutes > 0
    ? sectionDurationMinutes * 60 * 1000
    : 0;
  const sectionPaused = Number(activity?.section_timer_paused) === 1;
  const sectionElapsedMs = sectionStartedAtMs == null || sectionPaused ? 0 : Math.max(0, now - sectionStartedAtMs);
  const sectionElapsedRatio = sectionDurationMs > 0 ? sectionElapsedMs / sectionDurationMs : 0;

  const latestActivityAtMs = maxMs(latestDraftAt, latestSubmissionAt);
  const latestSubmissionAtMs = toMs(latestSubmissionAt);
  const latestFeedbackAtMs = toMs(latestFeedbackAt);
  const presenceWindowMs = Math.max(1, resolvedPresenceWindowMinutes) * 60 * 1000;
  const idleToleranceMs = Math.max(1, resolvedIdleToleranceMinutes) * 60 * 1000;
  const recentSubmissionWindowMs = Math.max(1, resolvedRecentSubmissionMinutes) * 60 * 1000;
  const paceLagMs = Math.max(0, resolvedPaceLagMinutes) * 60 * 1000;

  const isConnected = Array.isArray(groupMembers)
    && groupMembers.some((member) => Boolean(member?.connected) || isHeartbeatRecent(member, now, presenceWindowMs));
  const sectionJustStarted = sectionStartedAtMs != null && now - sectionStartedAtMs <= idleToleranceMs;
  const recentDraftOrResponse = latestActivityAtMs != null && now - latestActivityAtMs <= idleToleranceMs;
  const recentSubmission = latestSubmissionAtMs != null && now - latestSubmissionAtMs <= recentSubmissionWindowMs;

  if (isConnected || sectionJustStarted || recentDraftOrResponse || recentSubmission) {
    return 'active_thinking';
  }

  if (latestFeedbackAtMs != null && (latestActivityAtMs == null || latestFeedbackAtMs >= latestActivityAtMs)) {
    return 'stuck_after_feedback';
  }

  const peerLatestActivityMs = peerSignals
    .map((peer) => maxMs(peer?.latestActivityAt, peer?.latestSubmissionAt))
    .filter((value) => value != null);
  const peerMedianActivityMs = median(peerLatestActivityMs);
  const peerPaceLagging = latestActivityAtMs != null
    && peerMedianActivityMs != null
    && peerMedianActivityMs - latestActivityAtMs >= paceLagMs;

  const elapsedTooFar = sectionDurationMs > 0 && !sectionPaused && sectionElapsedRatio >= resolvedFallingBehindThreshold;
  const behindPeers = peerPaceLagging;

  if (elapsedTooFar || behindPeers) {
    return 'falling_behind';
  }

  const majorityElapsed = sectionDurationMs > 0 && !sectionPaused && sectionElapsedRatio >= resolvedMajorityElapsedThreshold;
  if (majorityElapsed) {
    return 'needs_check_in';
  }

  return 'needs_check_in';
}

export { PROGRESS_STATUS_VALUES };
