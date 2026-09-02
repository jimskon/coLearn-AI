import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

import { API_BASE_URL } from '../../config';

export default function useRunActivitySync({
  enableLiveSync = true,
  instanceId,
  user,
  groups,
  canPollActiveStudent,
  canSendHeartbeat,
  progressStatus,
  currentTimedSection,
  setActivity,
  activeStudentId,
  setActiveStudentId,
  setExistingAnswers,
  setTextFeedbackShown,
  setCodeFeedbackShown,
  setFollowupsShown,
  findQuestionBlockByQid,
  dirtyKeysRef,
}) {
  const [socket, setSocket] = useState(null);
  const activeStudentIdRef = useRef(null);

  useEffect(() => {
    activeStudentIdRef.current = activeStudentId;
  }, [activeStudentId]);

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
    return () => socket.off('instance:state', onInstanceState);
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
    if (!canSendHeartbeat) return;
    if (String(progressStatus || '').toLowerCase() === 'completed') return;
    const sendHeartbeat = async () => {
      if (!user?.id || !instanceId || !Array.isArray(groups) || groups.length === 0) return;
      try {
        const res = await fetch(
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

        // Reconcile the timer from the heartbeat response.
        //
        // The server announces a NEW timer once, over the socket. A client that
        // was not in the room at that moment never hears it, and no later
        // heartbeat re-announces it, so the timer would stay invisible for that
        // student until a full page reload. The heartbeat now returns the
        // current timer state every time, which makes this a 20s self-heal for
        // any missed broadcast.
        const data = await res.json().catch(() => null);
        const timer = data?.sectionTimer;
        if (timer) {
          setActivity((prev) => {
            if (!prev) return prev;
            // Only replace the object when a field actually differs, otherwise
            // every heartbeat would re-render the whole activity page.
            const changed = Object.keys(timer).some(
              (key) => (prev[key] ?? null) !== (timer[key] ?? null)
            );
            return changed ? { ...prev, ...timer } : prev;
          });
        }
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
    setActivity,
  ]);

  useEffect(() => {
    if (!socket) return;

    const handleUpdate = ({ responseKey, value, answeredBy }) => {
      if (answeredBy && String(answeredBy) === String(user?.id)) return;

      // Temporarily mark this key dirty so a concurrent loadActivity() call
      // does not overwrite the fresh socket value with an older DB snapshot
      // (Race B/D fix). The key auto-clears after 3 s.
      dirtyKeysRef?.current?.addTemp?.(responseKey, 3000);

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
          if (txt) {
            // Preserve the 'positive' flag that handleSubmit set; socket echoes
            // arrive after the { text, positive } object is already stored, so
            // read it from prev rather than overwriting with a bare string.
            const existingPositive = (typeof prev[qid] === 'object') ? prev[qid].positive : false;
            next[qid] = { text: txt, positive: existingPositive };
          } else {
            delete next[qid];
          }
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

    // A completed AI exchange on this instance. Turn rows are append-only and
    // keyed by qid, so applying one is idempotent: the student who asked and
    // every observer converge on the same transcript, and a re-delivered event
    // simply rewrites the row it already has.
    const handleAiTurn = ({ qid, turn }) => {
      if (!qid || !turn) return;
      dirtyKeysRef?.current?.addTemp?.(qid, 3000);
      setExistingAnswers((prev) => ({
        ...prev,
        [qid]: { response: JSON.stringify(turn), type: 'text' },
      }));
    };

    socket.on('response:update', handleUpdate);
    socket.on('feedback:update', handleFeedbackUpdate);
    socket.on('ai:turn', handleAiTurn);

    return () => {
      socket.off('response:update', handleUpdate);
      socket.off('feedback:update', handleFeedbackUpdate);
      socket.off('ai:turn', handleAiTurn);
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
