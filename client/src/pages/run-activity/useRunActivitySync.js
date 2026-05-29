import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

import { API_BASE_URL } from '../../config';

export default function useRunActivitySync({
  instanceId,
  user,
  groups,
  canPollActiveStudent,
  canSendHeartbeat,
  currentTimedSection,
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

  useEffect(() => {
    activeStudentIdRef.current = activeStudentId;
  }, [activeStudentId]);

  useEffect(() => {
    const s = io(API_BASE_URL, {
      transports: ['websocket'],
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

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

      if (patch.activeStudentId != null) setActiveStudentId(patch.activeStudentId);
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

        const nextId = Number(data?.activeStudentId);

        if (Number.isFinite(nextId) && nextId > 0 && nextId !== activeStudentIdRef.current) {
          setActiveStudentId(nextId);
        }
      } catch { }
    }, 5000);

    return () => clearInterval(interval);
  }, [instanceId, canPollActiveStudent, setActiveStudentId]);

  useEffect(() => {
    if (!canSendHeartbeat) return;
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

