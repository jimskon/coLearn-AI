import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '../../config';

export default function useRunActivityResponses({
  instanceId,
  user,
  isActive,
  setLastEditTs,
}) {
  const codeByKeyRef = useRef(Object.create(null));
  const dirtyKeysRef = useRef(new Set());
  const dirtyTextQidsRef = useRef(new Set());

  const [followupsShown, setFollowupsShown] = useState({});
  const [followupAnswers, setFollowupAnswers] = useState({});
  const [codeFeedbackShown, setCodeFeedbackShown] = useState({});
  const [fileContents, setFileContents] = useState({});
  const fileContentsRef = useRef(fileContents);
  const [codeViewMode, setCodeViewMode] = useState({});
  const [localCode, setLocalCode] = useState({});
  const [unansweredShown, setUnansweredShown] = useState({});
  const [submitAlert, setSubmitAlert] = useState(null);
  const [existingAnswers, setExistingAnswers] = useState({});
  const [textFeedbackShown, setTextFeedbackShown] = useState({});

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  const getLatestCode = useCallback((key) => {
    if (Object.prototype.hasOwnProperty.call(codeByKeyRef.current, key)) {
      return codeByKeyRef.current[key];
    }
    if (existingAnswers?.[key]?.response != null) {
      return existingAnswers[key].response;
    }
    return null;
  }, [existingAnswers]);

  const clearTextSuggestionForQid = useCallback((qid) => {
    setTextFeedbackShown((prev) => {
      const next = { ...prev };
      delete next[qid];
      return next;
    });
  }, []);

  const toggleCodeViewMode = useCallback((rk, next) => {
    setCodeViewMode((prev) => ({ ...prev, [rk]: next }));
  }, []);

  const updateLocalCode = useCallback((rk, code) => {
    setLastEditTs(Date.now());
    dirtyKeysRef.current.add(rk);
    setLocalCode((prev) => ({ ...prev, [rk]: code }));
  }, [setLastEditTs]);

  const handleUpdateFileContents = useCallback((updaterFn) => {
    setSubmitAlert(null);
    setLastEditTs(Date.now());
    setFileContents((prev) => {
      const updated = updaterFn(prev);
      fileContentsRef.current = updated;
      return updated;
    });
  }, [setLastEditTs]);

  const handleFileChange = useCallback((fileKey, newText, meta = {}) => {
    setSubmitAlert(null);
    setLastEditTs(Date.now());
    const raw = meta.filename || fileKey || '';
    const filename = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;

    setFileContents((prev) => {
      const updated = { ...prev, [filename]: newText };
      fileContentsRef.current = updated;
      return updated;
    });
  }, [setLastEditTs]);

  const handleTextChange = useCallback((responseKey, value, { baseQidFromResponseKey, socket } = {}) => {
    setSubmitAlert(null);
    dirtyKeysRef.current.add(responseKey);
    const qid = typeof baseQidFromResponseKey === 'function'
      ? baseQidFromResponseKey(responseKey)
      : null;

    if (qid) {
      setUnansweredShown((prev) => {
        if (!prev[qid]) return prev;
        const next = { ...prev };
        delete next[qid];
        return next;
      });
      dirtyTextQidsRef.current.add(qid);
    }

    setExistingAnswers((prev) => ({
      ...prev,
      [responseKey]: {
        ...(prev[responseKey] || {}),
        response: value,
        type: 'text',
      },
    }));

    if (isActive && socket) {
      socket.emit('response:update', {
        instanceId,
        responseKey,
        value,
        answeredBy: user?.id,
      });
    }

    setLastEditTs(Date.now());
  }, [instanceId, isActive, setLastEditTs, user?.id]);

  const handleCodeChange = useCallback(async (responseKey, updatedCode, meta = {}) => {
    setSubmitAlert(null);

    const baseQid = typeof meta?.baseQidFromResponseKey === 'function'
      ? meta.baseQidFromResponseKey(responseKey)
      : null;

    if (baseQid) {
      setUnansweredShown((prev) => {
        if (!prev[baseQid]) return prev;
        const next = { ...prev };
        delete next[baseQid];
        return next;
      });
    }

    const broadcastOnly = !!meta?.__broadcastOnly;
    codeByKeyRef.current[responseKey] = updatedCode;

    if (broadcastOnly) {
      if (!isActive) return;
      meta.socket?.emit('response:update', { instanceId, responseKey, value: updatedCode, answeredBy: user?.id });
      return;
    }

    setLastEditTs(Date.now());
    dirtyKeysRef.current.add(responseKey);

    setExistingAnswers((prev) => ({
      ...prev,
      [responseKey]: { ...(prev[responseKey] || {}), response: updatedCode, type: 'text' },
    }));

    if (isActive) {
      try {
        await fetch(`${API_BASE_URL}/api/responses/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            question_id: responseKey,
            activity_instance_id: instanceId,
            user_id: user?.id,
            response: updatedCode,
          }),
        });
        dirtyKeysRef.current.delete(responseKey);
      } catch (err) {
        console.error('handleCodeChange failed:', err);
      }
    }

    if (isActive) {
      meta.socket?.emit('response:update', { instanceId, responseKey, value: updatedCode, answeredBy: user?.id });
    }

    setCodeFeedbackShown((prev) => ({ ...prev, [responseKey]: null }));
    if (isActive) {
      meta.socket?.emit('feedback:update', { instanceId, responseKey, feedback: null, followup: null });
    }
  }, [instanceId, isActive, setLastEditTs, user?.id]);

  return {
    codeByKeyRef,
    dirtyKeysRef,
    dirtyTextQidsRef,
    followupsShown,
    setFollowupsShown,
    followupAnswers,
    setFollowupAnswers,
    codeFeedbackShown,
    setCodeFeedbackShown,
    fileContents,
    setFileContents,
    fileContentsRef,
    codeViewMode,
    localCode,
    unansweredShown,
    setUnansweredShown,
    submitAlert,
    setSubmitAlert,
    existingAnswers,
    setExistingAnswers,
    textFeedbackShown,
    setTextFeedbackShown,
    getLatestCode,
    clearTextSuggestionForQid,
    toggleCodeViewMode,
    updateLocalCode,
    handleUpdateFileContents,
    handleFileChange,
    handleTextChange,
    handleCodeChange,
  };
}
