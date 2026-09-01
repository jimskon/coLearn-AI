import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '../../config';

export default function useRunActivityResponses({
  instanceId,
  user,
  isActive,
  setLastEditTs,
  persistResponses = true,
  emitLiveUpdates = true,
}) {
  const codeByKeyRef = useRef(Object.create(null));
  // Debounce timers for DB saves — keyed by responseKey. The socket emit still
  // fires immediately so the observer sees live keystrokes (Race C fix).
  const saveDebounceRef = useRef(new Map());
  // Reference-counted dirty tracker: a key stays "dirty" until every concurrent
  // in-flight save for it has resolved, preventing loadActivity from overwriting
  // a key that still has an unresolved fetch (Race A fix).
  const dirtyKeysRef = useRef({
    _counts: new Map(),
    add(k)    { this._counts.set(k, (this._counts.get(k) || 0) + 1); },
    delete(k) { const n = (this._counts.get(k) || 1) - 1; if (n <= 0) { this._counts.delete(k); } else { this._counts.set(k, n); } },
    has(k)    { return (this._counts.get(k) || 0) > 0; },
    // Temporarily mark a key dirty for `ms` ms — used by socket handler so
    // loadActivity doesn't overwrite a freshly socket-received value (Race B/D fix).
    addTemp(k, ms = 3000) { this.add(k); setTimeout(() => this.delete(k), ms); },
  });
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

  // Called when this user becomes the active student. Discards any local-sandbox
  // edits and resets all code blocks back to "Following Active" mode so they
  // display the DB-saved version loaded by the subsequent loadActivity() call.
  const clearLocalSandbox = useCallback(() => {
    setLocalCode({});
    setCodeViewMode({});
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

    if (emitLiveUpdates && isActive && socket) {
      socket.emit('response:update', {
        instanceId,
        responseKey,
        value,
        answeredBy: user?.id,
      });
    }

    setLastEditTs(Date.now());
  }, [emitLiveUpdates, instanceId, isActive, setLastEditTs, user?.id]);

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
      if (!emitLiveUpdates || !isActive) return;
      meta.socket?.emit('response:update', { instanceId, responseKey, value: updatedCode, answeredBy: user?.id });
      return;
    }

    setLastEditTs(Date.now());
    dirtyKeysRef.current.add(responseKey);

    setExistingAnswers((prev) => ({
      ...prev,
      [responseKey]: { ...(prev[responseKey] || {}), response: updatedCode, type: 'text' },
    }));

    // Emit to socket immediately so observer sees live keystrokes
    if (emitLiveUpdates && isActive) {
      meta.socket?.emit('response:update', { instanceId, responseKey, value: updatedCode, answeredBy: user?.id });
    }

    // Debounce the DB write: cancel any pending save for this key and schedule
    // a new one. This collapses rapid keystrokes into one DB write per burst,
    // preventing out-of-order responses from landing a stale value (Race C fix).
    if (persistResponses && isActive) {
      if (saveDebounceRef.current.has(responseKey)) {
        clearTimeout(saveDebounceRef.current.get(responseKey));
      }
      const timerId = setTimeout(async () => {
        saveDebounceRef.current.delete(responseKey);
        // Capture the latest value at fire time, not at schedule time
        const latestCode = codeByKeyRef.current[responseKey];
        try {
          await fetch(`${API_BASE_URL}/api/responses/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              question_id: responseKey,
              activity_instance_id: instanceId,
              user_id: user?.id,
              response: latestCode,
            }),
          });
        } catch (err) {
          console.error('handleCodeChange DB save failed:', err);
        } finally {
          dirtyKeysRef.current.delete(responseKey);
        }
      }, 300);
      saveDebounceRef.current.set(responseKey, timerId);
    }

    setCodeFeedbackShown((prev) => ({ ...prev, [responseKey]: null }));
    if (emitLiveUpdates && isActive) {
      meta.socket?.emit('feedback:update', { instanceId, responseKey, feedback: null, followup: null });
    }
  }, [emitLiveUpdates, instanceId, isActive, persistResponses, setLastEditTs, user?.id]);

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
    clearLocalSandbox,
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
