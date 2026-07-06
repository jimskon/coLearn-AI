import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || '';

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

function normalizeStatusValue(rawStatus) {
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
  const config = progressMonitorConfig && typeof progressMonitorConfig === "object" ? progressMonitorConfig : {};
  const resolvedIdleToleranceMinutes = Number(config.idleToleranceMinutes ?? idleToleranceMinutes) || idleToleranceMinutes;
  const resolvedRecentSubmissionMinutes = Number(config.recentSubmissionMinutes ?? recentSubmissionMinutes) || recentSubmissionMinutes;
  const resolvedPresenceWindowMinutes = Number(config.presenceWindowMinutes ?? presenceWindowMinutes) || presenceWindowMinutes;
  const resolvedMajorityElapsedThreshold = Number(config.majorityElapsedThreshold ?? majorityElapsedThreshold) || majorityElapsedThreshold;
  const resolvedFallingBehindThreshold = Number(config.fallingBehindThreshold ?? fallingBehindThreshold) || fallingBehindThreshold;
  const resolvedPaceLagMinutes = Number(config.paceLagMinutes ?? paceLagMinutes) || paceLagMinutes;

  const normalizedProgress = normalizeStatusValue(activity?.progress_status);
  if (normalizedProgress === 'completed') return 'completed';

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

  const currentSubmittedCount = Number(submittedQuestionCount) || 0;
  const currentQuestionTotal = Number(currentQuestionCount) || 0;
  const sectionCompleted = normalizedProgress === 'completed'
    || (currentQuestionTotal > 0 && currentSubmittedCount >= currentQuestionTotal);
  if (sectionCompleted) return 'completed';

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

function buildSectionQuestionIds(groups = [], currentGroupIndex = -1) {
  const group = Array.isArray(groups) && currentGroupIndex >= 0 ? groups[currentGroupIndex] : null;
  if (!group) return [];

  const blocks = [group.intro, ...(group.content || []), ...(group.prelude || [])].filter(Boolean);
  const questionIds = [];
  for (const block of blocks) {
    if (block?.type !== 'question') continue;
    const qid = String(block.groupId || '') + String(block.id || '');
    if (qid) questionIds.push(qid);
  }
  return questionIds;
}

export default function useRunActivitySync({
  enableLiveSync = true,
  instanceId,
  user,
  groups,
  canPollActiveStudent,
  canSendHeartbeat,
  progressStatus,
  activity,
  currentTimedSection,
  currentGroupIndex,
  setActivity,
  activeStudentId,
  setActiveStudentId,
  setExistingAnswers,
  setTextFeedbackShown,
  setCodeFeedbackShown,
  setFollowupsShown,
  findQuestionBlockByQid,
}) {
  const [socket, setSocket] = useState(null);
  const activeStudentIdRef = useRef(null);
  const progressStatusRef = useRef(null);
  const progressObserverInFlightRef = useRef(false);
  const progressObserverSnapshotRef = useRef(null);

  useEffect(() => {
    activeStudentIdRef.current = activeStudentId;
  }, [activeStudentId]);

  useEffect(() => {
    if (String(progressStatus || '').toLowerCase() === 'completed') {
      progressStatusRef.current = 'completed';
    }
  }, [progressStatus]);

  useEffect(() => {
    if (!enableLiveSync) {
      setSocket(null);
      return undefined;
    }

    const s = io(API_BASE_URL, {
      transports: ['websocket'],
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [enableLiveSync]);

  useEffect(() => {
    if (!socket || !instanceId) return;

    socket.emit('instance:join', { instanceId });

    return () => {
      socket.emit('instance:leave', { instanceId });
    };
  }, [socket, instanceId]);

  useEffect(() => {
    if (!socket) return;

    function onInstanceState(msg) {
      const msgId = msg?.instanceId;
      const patch = msg?.patch;

      if (String(msgId) !== String(instanceId)) return;
      if (!patch || typeof patch !== 'object') return;

      setActivity((prev) => (prev ? { ...prev, ...patch } : prev));

      if (Object.prototype.hasOwnProperty.call(patch, 'activeStudentId')) {
        setActiveStudentId(patch.activeStudentId != null ? Number(patch.activeStudentId) : null);
      }
    }

    socket.on('instance:state', onInstanceState);

    function onProgressStatus(msg) {
      const msgId = msg?.activityInstanceId ?? msg?.instanceId;
      if (String(msgId) !== String(instanceId)) return;

      const nextStatus = normalizeStatusValue(msg?.newStatus);
      const previousStatus = normalizeStatusValue(msg?.previousStatus);
      progressStatusRef.current = nextStatus;

      setActivity((prev) => (prev ? {
        ...prev,
        progress_monitor_status: nextStatus,
        progress_monitor_previous_status: previousStatus,
        progress_monitor_updated_at: msg?.ts || Date.now(),
      } : prev));

      console.info('[progress-monitor] status update received', {
        instanceId: msgId,
        previousStatus,
        nextStatus,
      });
    }

    socket.on('progress:status', onProgressStatus);
    return () => {
      socket.off('instance:state', onInstanceState);
      socket.off('progress:status', onProgressStatus);
    };
  }, [socket, instanceId, setActivity, setActiveStudentId]);

  useEffect(() => {
    if (!canPollActiveStudent) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`, {
          credentials: 'include',
        });
        const data = await res.json();

        if (Object.prototype.hasOwnProperty.call(data || {}, 'activeStudentId')) {
          const rawId = data.activeStudentId;
          const nextId =
            rawId != null && Number.isFinite(Number(rawId)) && Number(rawId) > 0
              ? Number(rawId)
              : null;

          if (nextId !== activeStudentIdRef.current) {
            setActiveStudentId(nextId);
          }
        }
      } catch { }
    }, 5000);

    return () => clearInterval(interval);
  }, [instanceId, canPollActiveStudent, setActiveStudentId]);

  useEffect(() => {
    if (!socket || !instanceId || !user?.id) return undefined;

    const isCurrentActiveStudent = String(activeStudentId ?? '') === String(user.id);
    if (!isCurrentActiveStudent) {
      progressStatusRef.current = null;
      progressObserverSnapshotRef.current = null;
      return undefined;
    }

    let cancelled = false;

    const maybeEmitProgressStatus = async () => {
      if (progressObserverInFlightRef.current) return;
      progressObserverInFlightRef.current = true;

      try {
        const monitorPath = '/api/activity-instances/' + instanceId + '/progress-monitor';
        const snapshotRes = await fetch(API_BASE_URL + monitorPath, {
          credentials: 'include',
        });
        const snapshot = await snapshotRes.json().catch(() => ({}));
        if (cancelled || !snapshotRes.ok || !snapshot) return;

        progressObserverSnapshotRef.current = snapshot;
        const currentSectionQuestionIds = buildSectionQuestionIds(groups, currentGroupIndex);
        const nextStatus = classifyProgressStatus({
          now: Date.now(),
          activity: snapshot.activityInstance || activity,
          currentTimedSection,
          groupMembers: snapshot.groupMembers || [],
          latestDraftAt: snapshot.latestDraftAt,
          latestSubmissionAt: snapshot.latestSubmissionAt,
          latestFeedbackAt: snapshot.latestFeedbackAt,
          submittedQuestionCount: Array.isArray(snapshot.submittedQuestionIds) ? snapshot.submittedQuestionIds.length : 0,
          currentQuestionCount: currentSectionQuestionIds.length,
          peerSignals: snapshot.peerSignals || [],
        });

        if (!PROGRESS_STATUS_VALUES.has(nextStatus)) return;
        if (nextStatus === progressStatusRef.current) return;

        const previousStatus = progressStatusRef.current;
        const postPath = '/api/activity-instances/' + instanceId + '/progress-monitor/status';
        const postRes = await fetch(API_BASE_URL + postPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            previousStatus,
            newStatus: nextStatus,
          }),
        });

        if (!postRes.ok) return;
        progressStatusRef.current = nextStatus;
      } catch (err) {
        console.warn('[progress-monitor] observer tick failed', err);
      } finally {
        progressObserverInFlightRef.current = false;
      }
    };

    void maybeEmitProgressStatus();
    const interval = setInterval(() => {
      void maybeEmitProgressStatus();
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    socket,
    instanceId,
    user?.id,
    activeStudentId,
    activity,
    currentTimedSection,
    currentGroupIndex,
    groups,
  ]);

  useEffect(() => {
    if (!canSendHeartbeat) return;
    if (String(progressStatus || '').toLowerCase() === 'completed') return;
    const sendHeartbeat = async () => {
      if (!user?.id || !instanceId || !Array.isArray(groups) || groups.length === 0) return;
      try {
        await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}/heartbeat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              userId: user.id,
              sectionTimerKey: currentTimedSection?.key || null,
              sectionTimerDurationMinutes: currentTimedSection?.minutes || null,
            }),
          }
        );
      } catch { }
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(interval);
  }, [
    canSendHeartbeat,
    user?.id,
    instanceId,
    groups,
    progressStatus,
    currentTimedSection?.key,
    currentTimedSection?.minutes,
  ]);

  useEffect(() => {
    if (!socket) return;

    const handleUpdate = ({ responseKey, value, answeredBy }) => {
      if (answeredBy && String(answeredBy) === String(user?.id)) return;

      setExistingAnswers((prev) => ({
        ...prev,
        [responseKey]: {
          ...(prev[responseKey] || {}),
          response: value,
          type: 'text',
        },
      }));

      const mF1 = String(responseKey || '').match(/^(.*)F1$/);
      if (mF1) {
        const qid = mF1[1];
        const txt = String(value ?? '').trim();

        setTextFeedbackShown((prev) => {
          const next = { ...prev };
          if (txt) next[qid] = txt;
          else delete next[qid];
          return next;
        });
        return;
      }

      const mAF = String(responseKey || '').match(/^(.*)AF$/);
      if (mAF) {
        return;
      }
    };

    const handleFeedbackUpdate = ({ responseKey, feedback, followup }) => {
      setCodeFeedbackShown((prev) => ({
        ...prev,
        [responseKey]: feedback ?? null,
      }));

      const m = responseKey.match(/^(.*?)(?:code\d+)$/);
      if (!m) return;
      const qid = m[1];
      const block = findQuestionBlockByQid(qid);
      if (!block) return;

      setFollowupsShown((prev) => {
        const next = { ...prev };
        if (typeof followup === 'string' && followup.trim()) next[qid] = followup;
        else delete next[qid];
        return next;
      });
    };

    socket.on('response:update', handleUpdate);
    socket.on('feedback:update', handleFeedbackUpdate);

    return () => {
      socket.off('response:update', handleUpdate);
      socket.off('feedback:update', handleFeedbackUpdate);
    };
  }, [
    socket,
    user?.id,
    findQuestionBlockByQid,
    setExistingAnswers,
    setTextFeedbackShown,
    setCodeFeedbackShown,
    setFollowupsShown,
  ]);

  return socket;
}
