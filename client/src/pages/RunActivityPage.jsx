// client/src/pages/RunActivityPage.jsx
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Container, Alert, Button, ButtonGroup, Spinner } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { renderBlocks } from '../utils/parseSheet';
import { parseUtcDbDatetime } from '../utils/time';
import { normalizeRunActivityMode } from './run-activity/modes';
import useRunModePolicy from './run-activity/useRunModePolicy';
import useRunActivityData from './run-activity/useRunActivityData';
import useRunActivitySync from './run-activity/useRunActivitySync';
import useRunActivityResponses from './run-activity/useRunActivityResponses';
import RunActivityWorkspace from './run-activity/RunActivityWorkspace';
import { createInfoBubbleSession } from '../utils/infoBubbleSession';

import RunActivityTestStatusBanner from '../components/RunActivityTestStatusBanner';
import RunActivityFloatingTimer from '../components/RunActivityFloatingTimer';
import RunActivityHistoryView from '../components/RunActivityHistoryView';
import ActivityLoadingOverlay from '../components/ActivityLoadingOverlay';


function lowerResp(obj, key) {
  return String(obj?.[key]?.response ?? '').trim().toLowerCase();
}

function RUNTRACE(tag, obj) {
  console.log(`[RUNTRACE] ${tag}`, obj);
}


// --- DEBUG ---
const DEBUG_FILES = false;
const PAGE_TAG = 'RUN';

let globalRetriesRequired = 1;


// Map short role keys to full names
const roleLabels = {
  qc: 'Quality Control',
};

// Normalize question / group status strings
const normalizeStatus = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'complete' || s === 'completed') return 'complete';
  if (s === 'inprogress' || s === 'in_progress') return 'inprogress';
  return s || 'inprogress';
};

function isNoAI(val) {
  return String(val ?? '').trim().toLowerCase() === 'none';
}

// Infer lang for a code cell like "2acode1" by looking up the matching question block.
function getLangForResponseKey(responseKey, groups) {
  const baseQid = String(responseKey || '').replace(/code\d+$/i, '');

  let found = null;
  outer: for (const g of groups) {
    for (const b of [g.intro, ...(g.content || [])]) {
      if (b?.type === 'question' && `${b.groupId}${b.id}` === baseQid) {
        found = b;
        break outer;
      }
    }
  }
  if (!found) return 'python'; // safe default

  // prefer explicit block types
  if (Array.isArray(found.cppBlocks) && found.cppBlocks.length > 0) return 'cpp';
  if (Array.isArray(found.pythonBlocks) && found.pythonBlocks.length > 0)
    return 'python';
  if (Array.isArray(found.turtleBlocks) && found.turtleBlocks.length > 0) return 'python';


  // generic blocks with an explicit lang field
  if (Array.isArray(found.codeBlocks) && found.codeBlocks.length > 0) {
    const lang = String(found.codeBlocks[0].lang || '').toLowerCase();
    if (lang) return lang;
  }
  return 'python';
}

/*function dbg(label, obj) {
  try {
    console.log(`[RUNDBG] ${label}`, JSON.parse(JSON.stringify(obj)));
  } catch {
    console.log(`[RUNDBG] ${label}`, obj);
  }
}*/



function buildGroupSubmissionString({ groupNum, blocks, container, existingAnswers }) {
  const parts = [];

  for (const block of (blocks || [])) {
    if (block?.type !== 'question') continue;

    const qid = `${block.groupId}${block.id}`;

    const textEl = container?.querySelector(`textarea[data-response-key="${qid}"]`);
    const textVal =
      String(textEl?.value ?? existingAnswers?.[qid]?.response ?? '').trim();

    const codeTAs = Array.from(
      container?.querySelectorAll(`textarea[data-response-key^="${qid}code"]`) || []
    ).sort((a, b) => {
      const ka = a.getAttribute('data-response-key') || '';
      const kb = b.getAttribute('data-response-key') || '';
      return ka.localeCompare(kb);
    });

    const codeVals = codeTAs.map((ta) => [
      ta.getAttribute('data-response-key'),
      String(ta.value ?? '').trim(),
    ]);

    const tableEls = Array.from(
      container?.querySelectorAll(`[data-response-key^="${qid}table"]`) || []
    ).sort((a, b) => {
      const ka = a.getAttribute('data-response-key') || '';
      const kb = b.getAttribute('data-response-key') || '';
      return ka.localeCompare(kb);
    });

    const tableVals = tableEls.map((el) => [
      el.getAttribute('data-response-key'),
      String(el.value ?? '').trim(),
    ]);

    parts.push([qid, { textVal, codeVals, tableVals }]);
  }

  return JSON.stringify({ groupNum, parts });
}

function getQuestionText(block, qid) {
  const candidates = [
    block?.prompt,
    block?.content,
    block?.title,
    block?.introText,
    block?.header,
  ].filter(Boolean);
  const raw =
    candidates.find((s) => String(s).trim().length > 0) || `Question ${qid}`;
  return stripHtml(raw).trim();
}

function detectLanguageFromCode(code = '') {
  const s = code.trim();
  if (!s) return null;
  if (
    /\b#include\s*<[^>]+>/.test(s) ||
    /\bint\s+main\s*\(/.test(s) ||
    /std::(cout|cin|string)/.test(s)
  )
    return 'cpp';
  if (/\bdef\s+\w+\s*\(|\bprint\s*\(|^\s*#/.test(s)) return 'python';
  return null;
}

function isCodeOnlyByBlock(block) {
  const anyCode =
    (block?.pythonBlocks?.length || 0) +
    (block?.cppBlocks?.length || 0) +
    (block?.turtleBlocks?.length || 0) +
    (block?.codeBlocks?.length || 0) > 0;

  const hasText = !!block?.hasTextResponse;
  const hasTable = !!block?.hasTableResponse;

  return anyCode && !hasText && !hasTable;
}

function isCodeOnlyQuestion(block, qid, container, existingAnswers) {
  // If the parser says there is a text/table response, it's not code-only
  if (block?.hasTextResponse || block?.hasTableResponse) return false;

  // If there are authored code blocks, treat as code-only
  const anyAuthoredCode =
    (block?.pythonBlocks?.length || 0) > 0 ||
    (block?.turtleBlocks?.length || 0) > 0 ||
    (block?.cppBlocks?.length || 0) > 0 ||
    (block?.codeBlocks?.length || 0) > 0;

  if (anyAuthoredCode) return true;

  // Fallback: if DOM has code textareas for this qid and no base textarea, treat as code-only
  const hasBaseTA = !!container?.querySelector?.(`textarea[data-response-key="${qid}"]`);
  const codeTAs = container?.querySelectorAll?.(`textarea[data-response-key^="${qid}code"]`);
  const hasCodeTA = (codeTAs?.length || 0) > 0;

  if (!hasBaseTA && hasCodeTA) return true;

  // Fallback: if DB has code keys for this qid and no base answer key, treat as code-only
  const hasBaseInDB = existingAnswers && Object.prototype.hasOwnProperty.call(existingAnswers, qid);
  const hasCodeInDB = existingAnswers && Object.keys(existingAnswers).some(k => k.startsWith(`${qid}code`));

  return !hasBaseInDB && !!hasCodeInDB;
}


// NEW: pretty formatting for countdown
function formatRemainingSeconds(sec) {
  if (sec == null || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

function formatSectionMinutesLabel(remainingMs) {
  if (remainingMs <= 0) return 'Time out';

  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'} left`;
}

function stripHtml(s = '') {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*?)?>/g, '');
}

export default function RunActivityPage({
  setRoleLabel,
  setStatusText,
  groupMembers,
  setGroupMembers,
  activeStudentId,
  setActiveStudentId,
}) {
  const [viewMode, setViewMode] = useState('latest');
  const { user, loading } = useUser();

  const canViewHistory =
    user?.role === 'root' ||
    user?.role === 'creator' ||
    user?.role === 'instructor';

  const [historyRows, setHistoryRows] = useState([]);

  const effectiveViewMode = canViewHistory ? viewMode : 'latest';

  function emitTextAIState(socketInstance, qid, { f1, fm, af }) {
    if (!socketInstance || !instanceId || !user?.id) return;

    if (f1 !== undefined) {
      socketInstance.emit('response:update', {
        instanceId,
        responseKey: `${qid}F1`,
        value: f1 ?? '',
        answeredBy: user.id,
      });
    }

    if (fm !== undefined) {
      socketInstance.emit('response:update', {
        instanceId,
        responseKey: `${qid}FM`,
        value: fm ?? '',
        answeredBy: user.id,
      });
    }

    if (af !== undefined) {
      socketInstance.emit('response:update', {
        instanceId,
        responseKey: `${qid}AF`,
        value: af ?? '',
        answeredBy: user.id,
      });
    }
  }
  function baseQidFromResponseKey(key) {
    const k = String(key || '').toLowerCase();

    // group state key: "1state", "12state"
    if (/^\d+state$/.test(k)) return null;

    // AI / follow-up / state keys for a question:
    // 2aAF, 2aF1, 2aFA1, 2aS
    if (/^\d+[a-z]+af$/.test(k)) return null;
    if (/^\d+[a-z]+f\d+$/.test(k)) return null;
    if (/^\d+[a-z]+fa\d+$/.test(k)) return null;
    if (/^\d+[a-z]+s$/.test(k)) return null;

    // base qid: "2a", "12ab"
    const base = k.match(/^(\d+[a-z]+)$/);
    if (base) return base[1];

    // table/output/code keys
    const m = k.match(/^(\d+[a-z]+)(table|output|code)\d*/);
    if (m) return m[1];

    return null;
  }



  /*  function clearTextSuggestionForQid(qid) {
      setTextFeedbackShown((prev) => {
        const next = { ...prev };
        delete next[qid];
        return next;
      });
  
      // optional but safe if anything still uses followupsShown for text
      setFollowupsShown((prev) => {
        const next = { ...prev };
        delete next[qid];
        return next;
      });
    }*/

  const [lastEditTs, setLastEditTs] = useState(0);
  const { instanceId } = useParams();
  const location = useLocation();
  const requestedMode = new URLSearchParams(location.search).get('mode');
  const courseName = location.state?.courseName;
  const loadingRef = useRef(false);
  const codeVersionsRef = useRef({});
  const qidsNoFURef = useRef(new Set());
  const infoBubbleSessionRef = useRef(createInfoBubbleSession());

  const [activity, setActivity] = useState(null);
  const activityMode = activity?.meta?.mode || activity?.mode || 'group';
  const isPlaygroundMode = activityMode === 'demo' || activityMode === 'playground';

  const [groups, setGroups] = useState([]);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [preamble, setPreamble] = useState([]);
  const [sandboxGroupIndex, setSandboxGroupIndex] = useState(0);

  const currentGroupIndex = useMemo(() => {
    const completed = Number(activity?.completed_groups ?? 0);
    const safeCompleted = Number.isFinite(completed) && completed >= 0 ? completed : 0;

    const len = Array.isArray(groups) ? groups.length : 0;
    if (len <= 0) return 0;

    // ✅ next group index; when all groups complete this becomes len
    return safeCompleted >= len ? len : safeCompleted;
  }, [activity?.completed_groups, groups?.length]);


  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);


  // per-group “ignore AI, let me continue” overrides
  const [overrideGroups, setOverrideGroups] = useState({});
  const [canBypassGroups, setCanBypassGroups] = useState({});
  // { [groupIndex]: true }

  const [testLockState, setTestLockState] = useState({
    lockedBefore: false,
    lockedAfter: false,
    remainingSeconds: null,
  });

  // NEW: UI-only “time expired” flag for tests (locks editing, shows submit alert)
  const [timeExpired, setTimeExpired] = useState(false);
  // ✅ add this (prevents repeat auto-submit calls)
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [sectionTimerNowMs, setSectionTimerNowMs] = useState(() => Date.now());


  const [nonLegacyForUI, setNonLegacyForUI] = useState(false);

  const isLockedFU = (qid) => qidsNoFURef.current?.has(qid);

  const currentTimedSection = useMemo(() => {
    if (!Array.isArray(groups) || currentGroupIndex >= groups.length) return null;

    const group = groups[currentGroupIndex];
    const section = group?.section || null;
    if (!section?.key || !section?.minutes) return null;

    return {
      key: section.key,
      minutes: Number(section.minutes),
    };
  }, [groups, currentGroupIndex]);

  const sectionTimer = useMemo(() => {
    const startedAt = activity?.section_timer_started_at
      ? parseUtcDbDatetime(activity.section_timer_started_at)
      : null;
    const pausedAt = activity?.section_timer_paused_at
      ? parseUtcDbDatetime(activity.section_timer_paused_at)
      : null;
    const isPaused = Number(activity?.section_timer_paused) === 1;

    if (isPaused && !startedAt) {
      return {
        visible: true,
        label: 'Paused',
        background: '#6c757d',
        color: '#fff',
        paused: true,
      };
    }

    if (
      !currentTimedSection?.key ||
      !currentTimedSection?.minutes ||
      activity?.section_timer_key !== currentTimedSection.key ||
      !startedAt
    ) {
      return { visible: false };
    }

    const durationMs = currentTimedSection.minutes * 60 * 1000;
    const effectiveNowMs = isPaused && pausedAt ? pausedAt.getTime() : sectionTimerNowMs;
    const elapsedMs = effectiveNowMs - startedAt.getTime();
    const remainingMs = durationMs - elapsedMs;
    const ratio = durationMs > 0 ? remainingMs / durationMs : 0;

    let background = '#198754';
    let color = '#fff';
    let label = formatSectionMinutesLabel(remainingMs);
    if (isPaused) {
      background = '#6c757d';
      label = 'Paused';
    } else if (remainingMs <= 0) {
      background = '#dc3545';
    } else if (ratio <= 0.2) {
      background = '#ffc107';
      color = '#212529';
    }

    return {
      visible: true,
      label,
      background,
      color,
      paused: isPaused,
    };
  }, [
    activity?.section_timer_key,
    activity?.section_timer_paused,
    activity?.section_timer_paused_at,
    activity?.section_timer_started_at,
    currentTimedSection,
    sectionTimerNowMs,
  ]);




  const userRoles = groupMembers
    .filter((m) => String(m.student_id) === String(user.id))
    .map((m) => m.role)
    .filter(Boolean);
  const userRole =
    userRoles.length > 0
      ? userRoles.map((role) => roleLabels[role] || role).join(', ')
      : 'unknown';

  const activeStudentRoles = groupMembers
    .filter((m) => String(m.student_id) === String(activeStudentId))
    .map((m) => m.role)
    .filter(Boolean);
  const activeStudentRole =
    activeStudentRoles.length > 0
      ? activeStudentRoles.map((role) => roleLabels[role] || role).join(', ')
      : 'unknown';

  /*const currentGroupIndex = useMemo(() => {
    if (!existingAnswers || Object.keys(existingAnswers).length === 0) return 0;
    let count = 0;

    while (count < groups.length) {
      const raw = existingAnswers[`${count + 1}state`]?.response;
      const status = normalizeStatus(raw);

      if (status !== 'complete') break;
      count++;
    }

    return count;
  }, [existingAnswers, groups]);*/


  const isTestMode = useMemo(() => {
    if (activityMode === 'test') return true;

    // Primary: any instance with a time window is a test
    if (
      activity?.test_start_at &&
      Number(activity?.test_duration_minutes) > 0
    ) {
      return true;
    }

    // Secondary: explicit DB flag
    if (activity?.is_test === 1) return true;
    if (activity?.is_test === 0) return false;

    // Fallback heuristic
    if (!groups || groups.length !== 1) return false;
    return groups.some((g) =>
      (g.content || []).some(
        (b) =>
          b?.type === 'question' &&
          b.scores &&
          Object.keys(b.scores).length > 0
      )
    );
  }, [activityMode, activity, groups]);
  // ✅ Non-legacy test if its test_start_at is on/after 2026-01-01 UTC
  const isNonLegacyTest = useMemo(() => {
    if (!isTestMode) return false;

    const start = activity?.test_start_at
      ? parseUtcDbDatetime(activity.test_start_at)
      : null;

    if (!start) return false; // unknown => treat as legacy

    const cutoff = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)); // 2026-01-01 UTC
    return start.getTime() >= cutoff.getTime();
  }, [isTestMode, activity?.test_start_at]);

  useEffect(() => {
    console.log('[RUN] isTestMode:', isTestMode);
  }, [isTestMode]);

  useEffect(() => {
    if (!sectionTimer.visible || sectionTimer.paused) return undefined;

    const interval = setInterval(() => {
      setSectionTimerNowMs(Date.now());
    }, 5000);

    return () => clearInterval(interval);
  }, [sectionTimer.visible]);

  const runMode = normalizeRunActivityMode(requestedMode, { user });
  const {
    isSandbox,
    isInstructor,
    isStudent,
    isActive,
    isObserver,
    activityPaused,
    canPollActiveStudent,
    canSendHeartbeat,
    canUseLiveSync,
    allowFreeNavigation,
    canEditAnswers,
    canSubmitGroup,
    canSubmitTest,
    canRunAI,
    canPersistDrafts,
    canPersistSubmissions,
    canPersistAIResults,
    canRegradeTests,
    canSaveInstructorScores,
    canRefreshInstanceMetadata,
    loadPersistedResponses,
  } = useRunModePolicy({
    mode: runMode,
    user,
    activeStudentId,
    activity,
    isPlaygroundMode,
    isTestMode,
  });

  const {
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
  } = useRunActivityResponses({
    instanceId,
    user,
    isActive,
    setLastEditTs,
    persistResponses: canPersistDrafts,
    emitLiveUpdates: canUseLiveSync,
  });

  useEffect(() => {
    if (!allowFreeNavigation) return;
    setSandboxGroupIndex((prev) => {
      const maxIndex = Math.max(0, groups.length - 1);
      return prev > maxIndex ? maxIndex : prev;
    });
  }, [allowFreeNavigation, groups.length]);

  const loadActivity = useRunActivityData({
    instanceId,
    user,
    loadResponses: loadPersistedResponses,
    canRefreshInstanceMetadata,
    setActivity,
    setActiveStudentId,
    setGroupMembers,
    setExistingAnswers,
    setCodeFeedbackShown,
    setTextFeedbackShown,
    setFollowupAnswers,
    setNonLegacyForUI,
    setFileContents,
    setGroups,
    setPreamble,
    setFollowupsShown,
    dirtyKeysRef,
    dirtyTextQidsRef,
    qidsNoFURef,
    fileContentsRef,
    loadingRef,
    stripHtml,
    isNoAI,
  });

  useEffect(() => {
    if (!activityPaused) return;
    const activeEl = document.activeElement;
    if (activeEl && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }
  }, [activityPaused]);
  // NEW: compute test window from activity fields (if present)
  const testWindow = useMemo(() => {
    if (!isTestMode) return null;

    const startStr = activity?.test_start_at;
    const dur = activity?.test_duration_minutes;
    if (!startStr || !dur) return null;

    const start = parseUtcDbDatetime(startStr);
    if (!start) return null;

    let end = new Date(start.getTime() + Number(dur) * 60 * 1000);

    if (activity?.test_reopen_until) {
      const reopen = parseUtcDbDatetime(activity.test_reopen_until);
      if (reopen && reopen > end) {
        end = reopen;
      }
    }

    return { start, end };
  }, [
    isTestMode,
    activity?.test_start_at,
    activity?.test_duration_minutes,
    activity?.test_reopen_until,
  ]);
  useEffect(() => {
    console.log('[RUN] testWindow:', testWindow);
  }, [testWindow]);


  /* useEffect(() => {
     if (!isTestMode || !testWindow) {
       setTestLockState({
         lockedBefore: false,
         lockedAfter: false,
         remainingSeconds: null,
       });
       return;
     }
 
     const hasSubmitted = !!activity?.submitted_at;
     const { start, end } = testWindow;
 
     const update = () => {
       const now = new Date();
 
       let lockedBefore = false;
       let lockedAfter = hasSubmitted;
       let remainingSeconds = null;
 
       if (!lockedAfter) {
         if (now < start && !hasSubmitted) {
           // Before start window
           lockedBefore = true;
           lockedAfter = false;
           remainingSeconds = Math.floor(
             (start.getTime() - now.getTime()) / 1000
           );
         } else {
           // Inside or after window
           const diff = Math.floor((end.getTime() - now.getTime()) / 1000);
           remainingSeconds = diff > 0 ? diff : 0;
           lockedBefore = false;
 
           // IMPORTANT:
           // - While time remains, we keep lockedAfter = false.
           // - When time has run out (diff <= 0) *and* not yet submitted,
           //   we leave lockedAfter = false but remainingSeconds = 0.
           //   That gives the auto-submit effect a chance to run.
           // - Once submitted (hasSubmitted true in a later tick), we lock it.
           if (hasSubmitted) {
             lockedAfter = true;
           }
         }
 
       } else {
         remainingSeconds = 0;
       }
 
       setTestLockState({ lockedBefore, lockedAfter, remainingSeconds });
     };
 
     update();
     const id = setInterval(update, 1000);
     return () => clearInterval(id);
   }, [isTestMode, testWindow, activity?.submitted_at]);*/


  // NEW: if aicodeguidance says "Follow-ups: requirements-only", don't gate on AI feedback
  const isRequirementsOnly = useMemo(() => {
    const g = activity?.aicodeguidance || '';
    return /follow-ups:\s*requirements-only/i.test(g);
  }, [activity?.aicodeguidance]);

  // ✅ NEW: overall totals useMemo
  const overallTestTotals = useMemo(() => {
    if (!isTestMode || !groups || groups.length === 0) {
      return { earned: 0, max: 0 };
    }

    let earned = 0;
    let max = 0;

    for (const g of groups) {
      for (const b of g.content || []) {
        if (b?.type !== 'question') continue;
        const qid = `${b.groupId}${b.id}`;
        const { hasAnyScore, earnedTotal, maxTotal } = getQuestionScores(qid, b);
        if (!hasAnyScore) continue;
        if (Number.isFinite(earnedTotal)) earned += earnedTotal;
        if (Number.isFinite(maxTotal)) max += maxTotal;
      }
    }
    return { earned, max };
  }, [isTestMode, groups, existingAnswers]);

  useEffect(() => {
    if (!DEBUG_FILES) return;
    const sizes = Object.fromEntries(
      Object.entries(fileContents).map(([k, v]) => [k, (v ?? '').length])
    );
    console.debug(`[${PAGE_TAG}] fileContents changed:`, sizes);
  }, [fileContents]);

  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
      });
    const loadSkulpt = async () => {
      try {
        await loadScript(
          'https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js'
        );
        await loadScript(
          'https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js'
        );
        if (window.Sk && window.Sk.builtinFiles) setSkulptLoaded(true);
      } catch { }
    };
    loadSkulpt();
  }, []);

  useEffect(() => {
    if (user?.id) {
      loadActivity();
    }
  }, [user?.id, instanceId, loadActivity]);


  useEffect(() => {
    if (effectiveViewMode === 'history' && canViewHistory && instanceId) {
      loadHistory();
    }
  }, [effectiveViewMode, canViewHistory, instanceId]);

  // NOTE: findQuestionBlockByQid moved inside component so it can see `groups`
  function findQuestionBlockByQid(qid) {
    for (const g of groups) {
      for (const b of [g.intro, ...(g.content || [])]) {
        if (b?.type === 'question' && `${b.groupId}${b.id}` === qid) return b;
      }
    }
    return null;
  }

  const socket = useRunActivitySync({
    enableLiveSync: canUseLiveSync,
    instanceId,
    user,
    groups,
    canPollActiveStudent,
    canSendHeartbeat,
    progressStatus: activity?.progress_status,
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
  });


  useEffect(() => {
    if (!canPersistDrafts) return;
    if (!isActive || !user?.id || !instanceId) return;

    const interval = setInterval(() => {
      const textToSave = {};

      for (const [key, val] of Object.entries(existingAnswers)) {
        if (val?.type === 'text' && val.response?.trim()) {
          textToSave[key] = val.response.trim();
        }
      }

      for (const [key, val] of Object.entries(followupAnswers)) {
        if (val?.trim()) {
          textToSave[key] = val.trim();
        }
      }

      if (Object.keys(textToSave).length > 0) {
        fetch(`${API_BASE_URL}/api/responses/bulk-save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            instanceId,
            userId: user.id,
            answers: textToSave,
          }),
        }).catch(() => { });
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [canPersistDrafts, isActive, user?.id, instanceId, existingAnswers, followupAnswers]);

  useEffect(() => {
    if (!activeStudentId) return;
    const student = groupMembers.find(
      (m) => String(m.student_id) === String(activeStudentId)
    );
    if (student) {
      setActiveStudentName(student.name);
    } else {
      fetch(`${API_BASE_URL}/api/users/${activeStudentId}`)
        .then((res) => res.json())
        .then((userData) => setActiveStudentName(userData.name || '(unknown)'))
        .catch(() => setActiveStudentName('(unknown)'));
    }
  }, [activeStudentId, groupMembers]);

  useEffect(() => {
    Prism.highlightAll();
  }, [groups]);

  useEffect(() => {
    if (setRoleLabel) setRoleLabel(userRole);
    if (setStatusText)
      setStatusText(
        isActive ? 'You are the active student' : 'You are currently observing'
      );
  }, [userRole, isActive, setRoleLabel, setStatusText]);

  useEffect(() => {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
      if (user?.id === activeStudentId) {
        navbar.classList.remove('bg-primary', 'bg-dark');
        navbar.classList.add('bg-success');
      } else {
        navbar.classList.remove('bg-success', 'bg-dark');
        navbar.classList.add('bg-primary');
      }
    }
    return () => {
      if (navbar) {
        navbar.classList.remove('bg-success', 'bg-primary');
        navbar.classList.add('bg-dark');
      }
    };
  }, [user?.id, activeStudentId]);


  useEffect(() => {
    if (!isTestMode || !testWindow) {
      setTestLockState({ lockedBefore: false, lockedAfter: false, remainingSeconds: null });
      setTimeExpired(false);
      setAutoSubmitted(false); // ✅ reset when leaving test window
      return;
    }


    const { start, end } = testWindow;

    const tick = () => {
      const now = new Date();
      const isSubmittedNow = !!activity?.submitted_at;   // ✅ not stale

      let lockedBefore = false;
      let lockedAfter = isSubmittedNow;                  // ✅ DB truth only
      let remainingSeconds = 0;

      if (!isSubmittedNow) {
        if (now < start) {
          lockedBefore = true;
          remainingSeconds = Math.max(0, Math.floor((start.getTime() - now.getTime()) / 1000));
        } else {
          lockedBefore = false;
          remainingSeconds = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
        }
      } else {
        lockedBefore = false;
        remainingSeconds = 0;
      }

      setTestLockState({ lockedBefore, lockedAfter, remainingSeconds });

      // ✅ derive expiration solely from remainingSeconds + submitted state
      const expiredNow = !isSubmittedNow && !lockedBefore && remainingSeconds === 0;
      setTimeExpired(expiredNow);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isTestMode, testWindow, activity?.submitted_at]);


  // ✅ Auto-submit exactly once when time expires (test mode only)
  // MUST be top-level (not nested)
  useEffect(() => {
    if (!isTestMode) return;
    if (!isStudent) return;
    if (!!activity?.submitted_at) return;        // use DB truth
    if (testLockState.lockedBefore) return;
    if (!timeExpired) return;
    if (autoSubmitted) return;

    (async () => {
      try {
        setAutoSubmitted(true);
        await handleSubmit(false); // uses your TEST MODE PATH
      } catch (err) {
        console.error('Auto-submit failed:', err);
        // don't retry in a loop
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isTestMode,
    isStudent,
    activity?.submitted_at,
    testLockState.lockedBefore,
    timeExpired,
    autoSubmitted,
    instanceId,
  ]);


  async function saveResponse(instanceId, key, value) {
    if (!canPersistDrafts) return;
    await fetch(`${API_BASE_URL}/api/responses/draft-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        instanceId,
        userId: user.id,
        answers: { [key]: value },
      }),
    });
  }

  async function loadHistory() {
    try {
      const url = `${API_BASE_URL}/api/activity-instances/${instanceId}/responses/history`;
      console.log('[HISTORY] fetching', { url, instanceId });

      const res = await fetch(url, {
        credentials: 'include',
      });

      const raw = await res.text();
      console.log('[HISTORY] response', {
        ok: res.ok,
        status: res.status,
        rawHead: raw.slice(0, 500),
      });

      if (!res.ok) {
        throw new Error(`Failed to load history: ${res.status}`);
      }

      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.error('[HISTORY] JSON parse failed', e);
        throw e;
      }

      console.log('[HISTORY] parsed', data);
      const rows = Array.isArray(data) ? data : data?.rows || [];

      console.log(
        '[HISTORY rows for 2a]',
        rows.filter((r) => String(r.question_id || '').startsWith('2a'))
      );

      if (Array.isArray(data)) {
        setHistoryRows(data);
      } else if (Array.isArray(data?.rows)) {
        setHistoryRows(data.rows);
      } else {
        console.warn('[HISTORY] unexpected payload shape', data);
        setHistoryRows([]);
      }
    } catch (err) {
      console.error('Failed to load response history', err);
      setHistoryRows([]);
    }
  }

  if (loading) {
    return (
      <Container className="mt-4">
        <Spinner animation="border" />
      </Container>
    );
  }

  if (!user) {
    return (
      <Container className="mt-4">
        <Alert variant="danger">User not loaded. Please log in again.</Alert>
      </Container>
    );
  }

  async function evaluateResponseWithAI(
    questionBlock,
    studentAnswer,
    {
      forceFollowup = false,
      groupNum,                 // REQUIRED: runtime group number (completed_groups+1)
      retriesRequired = 1,      // OPTIONAL: global retry count
      submissionString = "",    // REQUIRED: stable per-click fingerprint
      answeredByUserId,         // OPTIONAL: user.id
    } = {}
  ) {
    // ✅ TEST MODE: no AI feedback at all
    if (isTestMode) return { accepted: true, feedback: null };
    if (!canRunAI) return { accepted: true, feedback: null };

    const qid = `${questionBlock.groupId}${questionBlock.id}`;
    const qText = getQuestionText(questionBlock, qid);

    // ✅ If sheet disables AI, DO NOT CALL AI. Treat as accepted.
    if (
      isLockedFU(qid) ||
      isNoAI(questionBlock?.followups?.[0]) ||
      isNoAI(questionBlock?.feedback?.[0])
    ) {
      console.log('[EVAL SKIP] AI disabled for question', { qid });
      return { accepted: true, feedback: null };
    }

    const codeContext = [
      ...(questionBlock.pythonBlocks || []).map((b) => b.content),
      ...(questionBlock.turtleBlocks || []).map((b) => b.content),
      ...(questionBlock.cppBlocks || []).map((b) => b.content),
      ...(questionBlock.codeBlocks || []).map((b) => b.content),
    ]
      .filter(Boolean)
      .join('\n\n');

    const instanceIdNum = Number(instanceId);          // from useParams


    const body = {
      qid,
      questionText: qText,
      studentAnswer,
      sampleResponse: questionBlock.samples?.[0] || '',
      feedbackPrompt: questionBlock.feedback?.[0] || '',
      followupPrompt: questionBlock.followups?.[0] || '',
      forceFollowup,
      context: {
        activitycontext: activity?.activitycontext || 'Unnamed Activity',
        studentLevel: activity?.studentlevel || 'intro',
      },
      guidance: activity?.aicodeguidance || '',
      codeContext,

      // ✅ retry gate inputs
      instanceId: instanceIdNum,
      groupNum: Number(groupNum),
      answeredByUserId: Number(answeredByUserId ?? user?.id),
      retriesRequired: Number(retriesRequired) || 1,
      submissionString: String(submissionString || ""),
      dryRun: !canPersistAIResults,
    };

    try {
      const t0 = performance.now();
      const url = `${API_BASE_URL}/api/ai/evaluate-response`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });


      const raw = await res.text();

      // (1) Remove this block entirely (it’s wrong position)
      // if (data?.accepted === true || data?.canContinue === true) { ... }

      // ✅ if backend returns an error, treat as failure
      if (!res.ok) {
        console.error('[EVAL HTTP ERROR]', {
          qid,
          status: res.status,
          rawHead: raw.slice(0, 200),
        });
        throw new Error(`evaluate-response failed ${res.status}`);
      }

      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.error('[EVAL JSON parse failed]', {
          qid,
          status: res.status,
          rawHead: raw.slice(0, 200),
        });
        throw e;
      }

      const accepted = data?.accepted !== false;

      const feedback =
        typeof data?.feedback === 'string' && data.feedback.trim()
          ? data.feedback.trim()
          : null;

      const canContinue = data?.canContinue === true;

      const retryCount = Number.isFinite(Number(data?.retryCount))
        ? Number(data.retryCount)
        : null;

      const retriesRequiredOut = Number.isFinite(Number(data?.retriesRequired))
        ? Number(data.retriesRequired)
        : null;

      return {
        accepted,
        feedback,
        canContinue,
        retryCount,
        retriesRequired: retriesRequiredOut,
      };

      // ✅ IMPORTANT: this function MUST NOT write to `answers` here.
      return {
        accepted: true,
        feedback: '(AI unavailable; continuing)',
        canContinue: false,
        retryCount: null,
        retriesRequired: null,
      };

    } catch (err) {
      console.error('[EVAL ERROR response]', {
        qid,
        name: err?.name,
        msg: err?.message,
      });

      // Policy: don't deadlock on AI failure
      return {
        accepted: true,
        feedback: '(AI unavailable; continuing)',
        canContinue: false,
        done: true,
        retryCount: null,
        retriesRequired: null,
        skipped: false,
      };
    }
  } // <-- closes evaluateResponseWithAI


  function buildMarkdownTableFromBlock(block, container) {
    if (!block.tableBlocks?.length) return '';
    let result = '';
    for (let t = 0; t < block.tableBlocks.length; t++) {
      const table = block.tableBlocks[t];
      result += `### ${table.title || 'Table'}\n\n`;
      const colCount = table.rows[0]?.length || 0;
      const markdownRows = [];
      for (let row = 0; row < table.rows.length; row++) {
        const cells = table.rows[row].map((cell, col) => {
          if (cell.type === 'static') return cell.content || '';
          if (cell.type === 'input') {
            const key = `${block.groupId}${block.id}table${t}cell${row}_${col}`;
            const val =
              container.querySelector(`[data-response-key="${key}"]`)
                ?.value?.trim() || '';
            return val;
          }
          return '';
        });
        markdownRows.push(`| ${cells.join(' | ')} |`);
      }
      if (markdownRows.length > 0) {
        const header = markdownRows[0];
        const separator = `| ${'--- |'.repeat(colCount)}`;
        result += [header, separator, ...markdownRows.slice(1)].join('\n') + '\n\n';
      }
    }
    return result;
  }

  // Normalize code for "changed?" checks
  function normalizeCode(s = '') {
    return String(s)
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .trim();
  }

  function collectQuestionCodeBlocks(block, qid, container, existingAnswers) {
    const prefix = `${qid}code`;

    // 1) Build authored blocks list in order
    const authoredBlocks = [
      ...(block?.pythonBlocks ?? []).map(b => ({ lang: 'python', content: b.content })),
      ...(block?.turtleBlocks ?? []).map(b => ({ lang: 'python', content: b.content })),
      ...(block?.cppBlocks ?? []).map(b => ({ lang: 'cpp', content: b.content })),
      ...(block?.codeBlocks ?? []).map(b => ({ lang: (b.lang || 'python'), content: b.content })),
    ];

    // ✅ YOUR POLICY: only keep the most recent authored code block
    const lastAuthored = authoredBlocks.length ? authoredBlocks[authoredBlocks.length - 1] : null;

    // Helper: get current code for a specific key, preferring live DOM/editor state
    const getLiveCodeForKey = (key) => {
      // A) Prefer DOM textarea if it exists (works for your current renderBlocks textarea approach)
      const ta = container?.querySelector?.(`textarea[data-response-key="${key}"]`);
      if (ta && typeof ta.value === 'string') return ta.value;

      // B) Otherwise prefer your in-memory ref (set by handleCodeChange)
      const fromRef = codeByKeyRef?.current?.[key];
      if (typeof fromRef === 'string') return fromRef;

      // C) Otherwise fallback to what’s already saved
      const fromDB = existingAnswers?.[key]?.response;
      if (typeof fromDB === 'string') return fromDB;

      return null;
    };

    // 2) If parser indicates code exists, we expose ONE cell: qidcode1
    if (lastAuthored) {
      const key = `${prefix}1`;

      const live = getLiveCodeForKey(key);
      const template = lastAuthored.content || '';
      const lang = lastAuthored.lang || 'python';

      // live > db/ref > template
      const code = (live != null ? live : template);

      return [{ key, lang, code: code ?? '', template }];
    }

    // 3) Fallback: if parser didn't annotate, discover keys from DB/DOM
    const keysFromDB = Object.keys(existingAnswers || {})
      .filter(k => k.startsWith(prefix))
      .sort((a, b) => (Number(a.replace(prefix, '')) || 0) - (Number(b.replace(prefix, '')) || 0));

    // If we found multiple keys, keep ONLY the most recent one (highest index)
    const chosenKey =
      keysFromDB.length ? keysFromDB[keysFromDB.length - 1]
        : `${prefix}1`;

    const live = getLiveCodeForKey(chosenKey);
    const code = live ?? '';

    return [{ key: chosenKey, lang: 'python', code, template: '' }];
  }


  // Prefer parser hints; otherwise fallback to simple detection
  function pickLangForBlock(block, studentCode) {
    if (Array.isArray(block?.cppBlocks) && block.cppBlocks.length) return 'cpp';
    if (Array.isArray(block?.pythonBlocks) && block.pythonBlocks.length) return 'python';
    if (Array.isArray(block?.turtleBlocks) && block.turtleBlocks.length) return 'python'; // ✅ fix
    const generic =
      Array.isArray(block?.codeBlocks) && block.codeBlocks[0]?.lang
        ? String(block.codeBlocks[0].lang).toLowerCase()
        : null;
    return generic || detectLanguageFromCode(studentCode) || 'python';
  }

  function buildTestSubmissionPayload(blocks, container) {
    const answers = {};
    const questions = [];

    for (const block of blocks) {
      if (block.type !== 'question') continue;

      const qid = `${block.groupId}${block.id}`;
      const questionText = getQuestionText(block, qid);

      // 1) Base written/text response (if any)
      const textEl = container.querySelector(`textarea[data-response-key="${qid}"]`);

      const baseAnswer = textEl?.value?.trim() || '';

      // 2) Table inputs (if any)
      let tableHasInput = false;
      let tableMarkdown = '';

      if (block.tableBlocks?.length > 0) {
        for (let t = 0; t < block.tableBlocks.length; t++) {
          const table = block.tableBlocks[t];

          for (let row = 0; row < table.rows.length; row++) {
            for (let col = 0; col < table.rows[row].length; col++) {
              const cell = table.rows[row][col];
              if (cell.type === 'input') {
                const key = `${qid}table${t}cell${row}_${col}`;
                const val =
                  container.querySelector(`[data-response-key="${key}"]`)
                    ?.value?.trim() || '';
                if (val !== '') {
                  answers[key] = val;
                  tableHasInput = true;
                }
              }
            }
          }
        }

        if (tableHasInput) {
          // Build a markdown snapshot of the student's table for grading
          tableMarkdown = buildMarkdownTableFromBlock(block, container);
        }
      }

      // 3) Harness output — gather mirrors like 1aoutput1, 1aoutput2, ...
      const outputEls = container.querySelectorAll(
        `[data-output-key^="${qid}output"]`
      );

      let combinedOutput = '';
      outputEls.forEach((el) => {
        const text = (el.textContent || '').trim();
        if (text) {
          combinedOutput += (combinedOutput ? '\n' : '') + text;
        }
      });

      const outputKey = `${qid}output`;
      const outputText =
        combinedOutput ||
        (existingAnswers[outputKey]?.response || '').trim();

      if (outputText) {
        answers[outputKey] = outputText;
      }

      // 4) Collect code cells for this question
      const rawCodeCells = collectQuestionCodeBlocks(
        block,
        qid,
        container,
        existingAnswers
      );

      // Save each code cell into answers as well (so it’s snapshotted)
      rawCodeCells.forEach(({ key, code }) => {
        answers[key] = code || '';
      });

      // Shape for the grader: only keep non-empty code cells, with lang + label
      const codeCells = rawCodeCells
        .map(({ key, code }) => {
          const src = code || '';
          return {
            code: src,
            lang: pickLangForBlock(block, src),
            label: key,      // lets the grader know which cell this is
          };
        })
        .filter((c) => c.code.trim() !== '');

      // 5) Decide what becomes the "responseText" for grading
      //    Priority: written -> table -> output
      const finalResponse = baseAnswer || tableMarkdown || outputText || (codeCells.length ? '[code submitted]' : '');

      if (finalResponse) {
        // Store main response for this question under its qid
        answers[qid] = finalResponse;
      }

      // 6) Push question object for gradeTestQuestion
      questions.push({
        qid,
        questionText,
        scores: block.scores || {},
        responseText: finalResponse,
        codeCells,
        outputText,
        // rubric: block.scores || {}, // optional; gradeTestQuestion already falls back to scores
      });
    }

    return { answers, questions };
  }


  function isGroupCodeOnlyQuestion(block) {
    const hasTextOrTable = !!block?.hasTextResponse || !!block?.hasTableResponse;
    if (hasTextOrTable) return false;

    const hasAnyCode =
      (block?.pythonBlocks?.length || 0) > 0 ||
      (block?.turtleBlocks?.length || 0) > 0 ||
      (block?.cppBlocks?.length || 0) > 0 ||
      (block?.codeBlocks?.length || 0) > 0;

    return hasAnyCode;
  }

  function collectAllVisibleAnswers() {
    const answers = {};

    document
      .querySelectorAll('[data-response-key]')
      .forEach((el) => {
        const key = el.getAttribute('data-response-key');

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          answers[key] = el.value || '';
        } else {
          answers[key] = el.textContent || '';
        }
      });

    return answers;
  }
  function collectVisibleAnswersFromContainer(container) {
    const answers = {};
    container.querySelectorAll('[data-response-key]').forEach((el) => {
      const key = el.getAttribute('data-response-key');
      if (!key) return;
      answers[key] = 'value' in el ? (el.value ?? '') : (el.textContent ?? '');
    });
    return answers;
  }
  async function handleSubmit(forceOverride = false, targetGroupIndex = null) {
    const attemptParts = [];
    let retriesRequired = 1;
    let groupNum;
    let submitGroupIndex = null;
    if (isSubmitting) return;
    // ✅ PLAYGROUND MODE: skip ALL evaluation logic
    if (isSubmitting) return;
    setSubmitAlert(null);
    setIsSubmitting(true);

    if (isPlaygroundMode) {
      try {
        const container = document.querySelector('[data-current-group="true"]');
        if (!container) return;

        const answers = collectVisibleAnswersFromContainer(container);

        if (canPersistDrafts) {
          await fetch(`${API_BASE_URL}/api/responses/bulk-save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              instanceId,
              userId: user.id,
              answers,
            }),
          });
        } else {
          setExistingAnswers((prev) => {
            const next = { ...prev };
            Object.entries(answers).forEach(([key, value]) => {
              next[key] = {
                ...(next[key] || {}),
                response: value,
                type: 'text',
              };
            });
            return next;
          });
        }

        // do NOT call setCurrentGroupIndex(...)
        // instead update the activity state that actually drives progression
        setActivity((prev) =>
          prev
            ? { ...prev, completed_groups: Number(prev.completed_groups ?? 0) + 1 }
            : prev
        );
      } catch (e) {
        console.error('Playground submit failed:', e);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setSubmitAlert(null);
    setIsSubmitting(true);

    let groupSubmissionString = null;
    let container = null;
    let blocks = null;
    const useTestSubmissionFlow = isTestMode && canSubmitTest;
    function clearCodeFeedbackForQid(qid, codeCells) {
      setCodeFeedbackShown((prev) => {
        const next = { ...prev };
        // Clear all known code cell keys for this question
        (codeCells || []).forEach(({ key }) => {
          delete next[key];          // or: next[key] = null;
        });

        // Safety net: clear any lingering keys that match the prefix
        Object.keys(next).forEach((k) => {
          if (k.startsWith(`${qid}code`)) delete next[k];
        });

        return next;
      });

      // Also clear observer-side echo if you want
      if (socket && instanceId) {
        (codeCells || []).forEach(({ key }) => {
          socket.emit('feedback:update', {
            instanceId,
            responseKey: key,
            feedback: null,
            followup: null,
          });
        });
      }
    }


    // ✅ TEST MODE: collect from the whole page + all question blocks
    if (useTestSubmissionFlow) {
      container = document;

      // Grab ALL blocks from ALL groups so we grade everything.
      blocks = groups.flatMap((g) => [g.intro, ...(g.content || [])]);
    } else {
      // ✅ LEARNING MODE: unchanged behavior (one group at a time)
      submitGroupIndex = isSandbox ? Number(targetGroupIndex ?? 0) : currentGroupIndex;
      container = isSandbox
        ? document.querySelector(`[data-sandbox-group="${submitGroupIndex}"]`)
        : document.querySelector('[data-current-group="true"]');
      if (!container) {
        alert('Error: No editable group found.');
        setIsSubmitting(false);
        return;
      }

      /*dbg('handleSubmit start', {
        isTestMode,
        currentGroupIndex,
        groupCount: groups.length,
        editableContainerFound: !!container,
        editableContainerAttr: container?.getAttribute('data-current-group'),
      });*/

      if (submitGroupIndex >= groups.length) {
        setIsSubmitting(false);
        return;
      }

      const currentGroup = groups[submitGroupIndex];

      // ✅ backend groupNum must be derived from instance progress (NOT block.groupId)
      const completedCount = Number(activity?.completed_groups ?? 0);
      groupNum = isSandbox ? submitGroupIndex + 1 : completedCount + 1; // ✅ 1-based, ALWAYS

      retriesRequired =
        Number(currentGroup?.intro?.retriesRequired ?? 1) || 1;

      blocks = [currentGroup.intro, ...currentGroup.content];

      groupSubmissionString = buildGroupSubmissionString({
        groupNum,
        blocks,
        container,
        existingAnswers,
      });
      /*console.log('[RETRY_FINGERPRINT]', {
        groupNum,
        retriesRequired,
        len: groupSubmissionString.length,
      });*/

      /*dbg('handleSubmit blocks', {
        blocksLen: blocks?.length,
        qids: (blocks || [])
          .filter(b => b?.type === 'question')
          .map(b => `${b.groupId}${b.id}`),
      });*/
    }


    // ---------- TEST MODE PATH ----------
    if (useTestSubmissionFlow) {
      try {
        const { answers, questions } = buildTestSubmissionPayload(
          blocks,
          container
        );
        console.log('[TEST SUBMIT payload]', {
          answersCount: Object.keys(answers).length,
          questionsCount: questions.length,
        });

        const res = await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}/submit-test`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              studentId: user.id,
              answers,
              questions,
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(
            `Test submission failed: ${err.error || 'Unknown error submitting test.'
            }`
          );
          setIsSubmitting(false);
          return;
        }

        // console.log('[RUNDBG] after submit, about to reload', { loading: loadingRef.current, t: Date.now() });
        await loadActivity();
        //console.log('[RUNDBG] after submit, reload done');
        alert('Test submitted. Your answers have been recorded.');
      } catch (err) {
        console.error('❌ Test submission failed:', err);
        alert('An error occurred submitting the test.');
      } finally {
        setIsSubmitting(false);
      }
      return; // 🚪 do not run learning-mode group logic
    }

    // ---------- ORIGINAL LEARNING-MODE PATH ----------
    const answers = {};
    const missingRequired = [];
    const missingRequiredMap = {};
    const pendingRevision = [];

    for (let block of blocks) {
      if (block.type !== 'question') continue;

      const qid = `${block.groupId}${block.id}`;
      const qText = getQuestionText(block, qid);
      // IMPORTANT:
      // - In TEST mode, do NOT apply the "simple policy" here.
      //   Tests must collect EVERYTHING (text + tables + code + outputs) for grading.
      // - In GROUP mode, apply the simple policy:
      //     code-only => evaluate code
      //     any text/table => default to text (do not evaluate code)
      const codeOnly = isTestMode
        ? isCodeOnlyQuestion(block, qid, container, existingAnswers) // preserve existing test behavior
        : ((block?.hasTextResponse || block?.hasTableResponse)
          ? false
          : ((block?.pythonBlocks?.length || 0) > 0 ||
            (block?.cppBlocks?.length || 0) > 0 ||
            (block?.codeBlocks?.length || 0) > 0));


      // ---- DEBUG: caller-side verdict + quick evidence ----
      const dbgTextTA = container?.querySelector(
        `textarea[data-response-key="${qid}"]`
      );

      const dbgCodeTAs = container?.querySelectorAll(
        `textarea[data-response-key^="${qid}code"]`
      );

      /*console.log('[RUNDBG] codeOnly verdict', {
        qid,
        codeOnly,
        blockFlags: {
          hasTextResponse: !!block?.hasTextResponse,
          hasTableResponse: !!block?.hasTableResponse,
          pythonBlocks: block?.pythonBlocks?.length || 0,
          turtleBlocks: block?.turtleBlocks?.length || 0,
          cppBlocks: block?.cppBlocks?.length || 0,
          codeBlocks: block?.codeBlocks?.length || 0,
        },
        domEvidence: {
          hasTextTA: !!dbgTextTA,
          textLen: dbgTextTA?.value?.trim()?.length || 0,
          codeTAcount: dbgCodeTAs?.length || 0,
          codeLens: dbgCodeTAs ? Array.from(dbgCodeTAs).map((t) => (t.value || '').length) : [],
        },
      });*/



      const textEl = container.querySelector(
        `textarea[data-response-key="${qid}"]`
      );
      const codeTAs = container.querySelectorAll(
        `textarea[data-response-key^="${qid}code"]`
      );
      const tableEls = container.querySelectorAll(
        `[data-response-key^="${qid}table"]`
      );

      const ansKeys = Object.keys(existingAnswers || {}).filter(k =>
        k.startsWith(qid)
      );
      const refKeys = Object.keys(codeByKeyRef.current || {}).filter(k =>
        k.startsWith(`${qid}code`)
      );

      /*dbg(`Q ${qid} presence`, {
        hasTextEl: !!textEl,
        textLen: textEl?.value?.trim()?.length || 0,
        codeTAcount: codeTAs.length,
        tableCount: tableEls.length,
        ansKeys,
        refKeys,
        domCodePreview: Array.from(codeTAs).map(ta => ({
          key: ta.getAttribute('data-response-key'),
          len: (ta.value || '').length,
          head: (ta.value || '').slice(0, 40),
        })),
        blockFlags: {
          hasTextResponse: !!block?.hasTextResponse,
          hasTableResponse: !!block?.hasTableResponse,
          pythonBlocks: block?.pythonBlocks?.length || 0,
          turtleBlocks: block?.turtleBlocks?.length || 0,
        },
      });*/
      const textAnswer = (textEl?.value ?? '').trim();
      const shouldEvalText = !isTestMode && !codeOnly && !!textEl;  // code+text AND text-only both land here

      /*console.log('[RUNDBG] eval gate', {
        qid,
        isTestMode,
        codeOnly,
        hasTextEl: !!textEl,
        textLen: textAnswer.length,
        shouldEvalText,
      });*/

      // ---------- CODE-ONLY PATH ----------
      if (codeOnly) {
        const attemptsKey = `${qid}attempts`;
        const prevAttempts = Number(
          existingAnswers[attemptsKey]?.response || 0
        );

        const codeCells = collectQuestionCodeBlocks(
          block,
          qid,
          container,
          existingAnswers
        );

        let changed = false;
        if (codeCells.some((c) => c.template && c.template.length)) {
          changed = codeCells.some(
            ({ code, template }) =>
              normalizeCode(code) !== normalizeCode(template)
          );
        } else {
          changed = codeCells.some(
            ({ code }) => normalizeCode(code).length > 0
          );
        }

        if (!changed) {
          const msg = 'Modify the starter program to solve the task, then submit again.';
          const targetKey = codeCells[0]?.key || `${qid}code1`;

          setCodeFeedbackShown((prev) => ({ ...prev, [targetKey]: msg }));

          // optional: broadcast to observers
          if (socket && instanceId) {
            socket.emit('feedback:update', {
              instanceId,
              responseKey: targetKey,
              feedback: msg,
              followup: null,
            });
          }

          answers[`${qid}S`] = 'inprogress';
          missingRequired.push(`${qid} (code not changed)`);
          missingRequiredMap[qid] = 'Unanswered: modify the code before submitting.';
          answers[`${qid}CodeFeedback`] = msg;
          answers[`${qid}CodeAccepted`] = 'false';
          answers[`${qid}CodeCanContinue`] = 'false';
          answers[`${qid}CodeRetryCount`] = '';
          answers[`${qid}CodeRetriesRequired`] = '';
          answers[`${qid}CodeSubmissionString`] = groupSubmissionString;

          codeCells.forEach(({ key, code }) => (answers[key] = code));
          continue;
        }


        codeCells.forEach(({ key, code }) => (answers[key] = code));

        // ✅ AI should evaluate ONLY the most recent code block (last one)
        const lastCell = codeCells[codeCells.length - 1];
        const studentCode = String(lastCell?.code ?? '').trim();

        const lang =
          pickLangForBlock(block, studentCode) ||
          detectLanguageFromCode(studentCode) ||
          'python';

        attemptParts.push({
          qid,
          type: 'code',
          lang,
          v: studentCode,
        });

        if (!studentCode) {
          const msg =
            'Please write or modify the starter code, then submit again.';
          setFollowupsShown((prev) => ({ ...prev, [qid]: msg }));
          answers[`${qid}S`] = 'inprogress';
          missingRequired.push(`${qid} (no code)`);
          missingRequiredMap[qid] = 'Unanswered: add or modify code before submitting.';
          answers[`${qid}CodeFeedback`] = msg;
          answers[`${qid}CodeAccepted`] = 'false';
          answers[`${qid}CodeCanContinue`] = 'false';
          answers[`${qid}CodeRetryCount`] = '';
          answers[`${qid}CodeRetriesRequired`] = '';
          answers[`${qid}CodeSubmissionString`] = groupSubmissionString;

          continue;
        }

        // ✅ collect observed output for this question
        const outputEls = container.querySelectorAll(
          `[data-output-key^="${qid}output"]`
        );

        let combinedOutput = '';
        outputEls.forEach((el) => {
          const text = (el.textContent || '').trim();
          if (text) {
            combinedOutput += (combinedOutput ? '\n' : '') + text;
          }
        });

        const outputText =
          combinedOutput ||
          String(existingAnswers?.[`${qid}output`]?.response ?? '').trim();

        try {
          const evalUrl = `${API_BASE_URL}/api/ai/evaluate-code`;

          const payload = {
            questionText: qText,
            studentCode,
            codeVersion: qid,
            lang,
            isCodeOnly: true,

            // question-level metadata
            feedbackPrompt: block.feedback?.[0] || '',
            sampleResponse: block.samples?.[0] || '',
            followupPrompt: block.followups?.[0] || '',

            // activity-level policy
            guidance: activity?.aicodeguidance || '',
            instanceId: Number(instanceId),
            groupNum,
            answeredByUserId: Number(user?.id),
            retriesRequired,
            submissionString: groupSubmissionString,
            dryRun: !canPersistAIResults,

            // ✅ new
            outputText,
          };

          const t0 = performance.now();

          const controller = new AbortController();
          const timeoutMs = 20000;
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          let aiRes, rawText, data;

          try {
            aiRes = await fetch(evalUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller.signal,
              credentials: 'include',
            });

            rawText = await aiRes.text();

            if (!aiRes.ok) {
              throw new Error(`evaluate-code ${aiRes.status}: ${(rawText || '').slice(0, 200)}`);
            }

            try {
              data = rawText ? JSON.parse(rawText) : null;
            } catch (e) {
              console.error('[EVAL1] JSON parse failed', {
                qid,
                err: String(e),
                rawFirst300: (rawText || '').slice(0, 300),
              });
              throw e;
            }

            if (data && typeof data === 'object') {
              const feedback =
                (typeof data.feedback === 'string' && data.feedback.trim()) ? data.feedback.trim()
                  : (typeof data.comment === 'string' && data.comment.trim()) ? data.comment.trim()
                    : '';

              const followup =
                (typeof data.followup === 'string' && data.followup.trim()) ? data.followup.trim()
                  : (typeof data.followupQuestion === 'string' && data.followupQuestion.trim()) ? data.followupQuestion.trim()
                    : '';

              const accepted = data?.accepted !== false;

              data = {
                ...data,
                accepted,
                feedback,
                followup,
              };
            }

            if (data?.canContinue === true) {
              setCanBypassGroups((prev) => ({ ...prev, [submitGroupIndex]: true }));
            }
          } finally {
            clearTimeout(timeoutId);
          }

          const accepted = data?.accepted !== false;

          let feedback = String(data?.feedback ?? '').trim();
          let followup = String(data?.followup ?? '').trim();

          // ---- PERSIST CODE AI STATE INTO ANSWERS (FOR HISTORY) ----
          answers[`${qid}CodeFeedback`] = feedback || '';
          answers[`${qid}CodeAccepted`] = accepted ? 'true' : 'false';
          answers[`${qid}CodeCanContinue`] = data?.canContinue ? 'true' : 'false';

          answers[`${qid}CodeRetryCount`] =
            data?.retryCount != null ? String(data.retryCount) : '';

          answers[`${qid}CodeRetriesRequired`] =
            data?.retriesRequired != null ? String(data.retriesRequired) : '';
          answers[`${qid}CodeSubmissionString`] = groupSubmissionString;

          if (!feedback && followup) {
            feedback = followup;
            followup = '';
          }

          const targetKey =
            codeCells.find((c) => normalizeCode(c.code).length > 0)?.key ||
            codeCells[0]?.key ||
            `${qid}code1`;

          // ✅ Only increment attempts when we actually need revision
          const nextAttempts = !accepted ? (prevAttempts + 1) : prevAttempts;
          answers[attemptsKey] = String(nextAttempts);

          // Show feedback if present (praise or hint), but do NOT use it as a gate
          if (feedback) {
            setCodeFeedbackShown((prev) => ({ ...prev, [targetKey]: feedback }));
            setFollowupsShown((prev) => {
              const x = { ...prev };
              delete x[qid];
              return x;
            });

            if (socket && instanceId) {
              socket.emit('feedback:update', {
                instanceId,
                responseKey: targetKey,
                feedback,
                followup: null,
              });
            }
          }
          // ✅ compute !accepted even if server returns only accepted/comment
          if (!accepted) {
            answers[`${qid}S`] = 'inprogress';
            pendingRevision.push(`${qid} (needs revision)`);
          } else {
            answers[`${qid}S`] = 'complete';

            // ✅ clear prior code feedback for this cell so the message disappears
            setCodeFeedbackShown((prev) => {
              const next = { ...prev };
              delete next[targetKey];         // or: next[targetKey] = null;
              return next;
            });



            // optional: clear any old guidance for all cells (only if you want)
            // codeCells.forEach(({ key }) => {
            //   setCodeFeedbackShown((prev) => ({ ...prev, [key]: null }));
            // });

            setFollowupsShown((prev) => {
              const x = { ...prev };
              delete x[qid];
              return x;
            });

            if (socket && instanceId) {
              socket.emit('feedback:update', {
                instanceId,
                responseKey: targetKey,
                feedback: feedback || null, // keep praise visible if you want
                followup: null,
              });
            }
          }

        } catch (err) {
          console.error('❌ AI code evaluation failed:', err);
          const msg = 'Couldn’t check your program. Try again.';
          setFollowupsShown((prev) => ({ ...prev, [qid]: msg }));
          answers[`${qid}S`] = 'inprogress';
          pendingRevision.push(`${qid} (evaluation error)`);
        }

        continue;
      }

      // ---------- TEXT/TABLE PATH ----------
      // NEW: Always collect and save any code blocks for this question,
      // even when we're defaulting to text/table evaluation.
      // This preserves features for group activities, and is harmless for text-only questions.
      const mixedCodeCells = collectQuestionCodeBlocks(
        block,
        qid,
        container,
        existingAnswers
      );

      // Save them into the outgoing payload (don’t AI-evaluate here)
      mixedCodeCells.forEach(({ key, code }) => {
        answers[key] = code;
      });

      const el = container.querySelector(`textarea[data-response-key="${qid}"]`);

      const baseAnswer =
        String(existingAnswers?.[qid]?.response ?? '').trim() ||
        String(container.querySelector(`[data-response-key="${qid}"]`)?.value ?? '').trim();


      // ---- Gather table inputs & save them ----
      let tableHasInput = false;
      if (block.tableBlocks?.length > 0) {
        for (let t = 0; t < block.tableBlocks.length; t++) {
          const table = block.tableBlocks[t];
          for (let row = 0; row < table.rows.length; row++) {
            for (let col = 0; col < table.rows[row].length; col++) {
              const cell = table.rows[row][col];
              if (cell.type === 'input') {
                const key = `${qid}table${t}cell${row}_${col}`;
                const val =
                  container.querySelector(`[data-response-key="${key}"]`)

                    ?.value?.trim() || '';
                if (val !== '') {
                  answers[key] = val;
                  tableHasInput = true;
                }
              }
            }
          }
        }
      }
      // ✅ Compute table markdown snapshot *only if used*
      const tableMarkdown =
        (block.hasTableResponse && tableHasInput)
          ? buildMarkdownTableFromBlock(block, container)
          : '';

      // Determine what gets evaluated as the "answer"
      let aiInput = baseAnswer;
      attemptParts.push({
        qid,
        type: 'text',
        v: aiInput, // includes table markdown snapshot if used
      });
      if (block.hasTableResponse && tableHasInput) {
        aiInput = tableMarkdown;
      }

      // If nothing at all was entered → required
      if (!aiInput) {
        missingRequired.push(`${qid} (base)`);
        missingRequiredMap[qid] = 'Unanswered: enter a response before submitting.';
        answers[`${qid}S`] = 'inprogress';

        setTextFeedbackShown((prev) => {
          const next = { ...prev };
          delete next[qid];
          return next;
        });

        continue;
      }


      // Save the main answer (text or table) to DB payload
      answers[qid] = aiInput;   // saves text OR table snapshot consistently

      // ---- AI evaluation (sticky-accepted / temporary-needsRevision) ----
      let accepted = true;
      let feedback = null;

      const looksCodeOnlyNow = isCodeOnlyQuestion(
        block,
        qid,
        container,
        existingAnswers
      );

      const prevAF = lowerResp(existingAnswers, `${qid}AF`); // "active" or "resolved"
      const prevFM = lowerResp(existingAnswers, `${qid}FM`); // "accepted" or "needsrevision"

      // ✅ Clear old AI comment ONLY on submit (before re-evaluating)
      setTextFeedbackShown((prev) => {
        const next = { ...prev };
        delete next[qid];
        return next;
      });

      answers[`${qid}F1`] = '';
      delete answers[`${qid}FM`];
      delete answers[`${qid}AF`];

      // Only clear the visible feedback box before re-eval
      emitTextAIState(socket, qid, { f1: '' });
      if (!looksCodeOnlyNow && !isTestMode) {
        const dbgInput = String(aiInput ?? '').trim();
        /*console.log('[EVALDBG]', {
          qid,
          hasText: dbgInput.length > 0,
          py: block?.pythonBlocks?.length || 0,
          codeBlocks: block?.codeBlocks?.length || 0,
          keys: Object.keys(existingAnswers || {})
            .filter(k => k.toLowerCase().includes(String(qid).toLowerCase()))
            .slice(0, 20),
        });*/
        const ai = await evaluateResponseWithAI(block, aiInput, {
          submissionString: groupSubmissionString,
          groupNum,                 // runtime group number you already computed
          retriesRequired,          // global retries (3)
          answeredByUserId: user.id,
        });

        const progressAllowed = (ai.accepted === true);

        answers[`${qid}S`] = progressAllowed ? 'complete' : 'inprogress';

        if (!progressAllowed) {
          pendingRevision.push(`${qid} (AI)`);
        }

        // If backend says retries threshold reached for this group, enable bypass button
        if (ai?.canContinue === true) {
          setCanBypassGroups((prev) => ({ ...prev, [submitGroupIndex]: true }));
        }
        /*console.log('[RETRY GATE]', {
          qid,
          accepted: ai.accepted,
          canContinue: ai.canContinue,
          progressAllowed,
        });*/

        // ✅ Default accept unless AI explicitly rejects
        accepted = ai.accepted !== false;
        feedback = typeof ai.feedback === 'string' ? ai.feedback : '';

        const newHasFeedback = typeof feedback === 'string' && feedback.trim().length > 0;
        const becomingAccepted = (prevAF === 'active') && accepted;

        answers[`${qid}AF`] = accepted ? 'resolved' : 'active';
        answers[`${qid}FM`] = accepted ? 'accepted' : 'needsRevision';

        if (feedback && feedback.trim()) {
          const f = feedback.trim();
          answers[`${qid}F1`] = f;
          setTextFeedbackShown((prev) => ({ ...prev, [qid]: f }));
        } else {
          answers[`${qid}F1`] = '';
          setTextFeedbackShown((prev) => {
            const next = { ...prev };
            delete next[qid];
            return next;
          });
        }

        emitTextAIState(socket, qid, {
          af: answers[`${qid}AF`],
          f1: answers[`${qid}F1`],
          fm: answers[`${qid}FM`],
        });
      }


    } // END for each block



    // ---- completion logic ----
    const qBlocks = blocks.filter((b) => b.type === 'question');
    const isCodeOnlyMap = Object.fromEntries(
      qBlocks.map((b) => {
        const qidB = `${b.groupId}${b.id}`;
        const isCodeOnly = isTestMode
          ? isCodeOnlyQuestion(b, qidB, container, existingAnswers)  // ✅ tests unchanged
          : isGroupCodeOnlyQuestion(b);                               // ✅ group simplification
        return [qidB, isCodeOnly];
      })
    );

    const pendingBase = missingRequired.length > 0;

    // ✅ Group number is derived only from instance progress
    const completedCount = Number(activity?.completed_groups ?? 0);
    //const groupNum = completedCount + 1; // 1-based for backend

    // ✅ Only acceptance matters: if any question isn't complete, group is inprogress
    const pendingByStatus = qBlocks.some((b) => {
      const qid = `${b.groupId}${b.id}`;
      const status = normalizeStatus(
        answers[`${qid}S`] ?? existingAnswers[`${qid}S`]?.response
      );
      return status !== 'complete';
    });


    const overrideThisGroup = forceOverride;

    const computedState =
      overrideThisGroup || (!pendingBase && !pendingByStatus)
        ? 'complete'
        : 'inprogress';

    const stateKey = `${groupNum}state`;
    answers[stateKey] = computedState;

    /*console.log('[RUNDBG] gate vars', {
      pendingBase,
      unanswered,
      pendingByStatus,
      overrideThisGroup,
      computedState,
      S: qBlocks.map(b => {
        const qid = `${b.groupId}${b.id}`;
        return [qid, answers[`${qid}S`], existingAnswers[`${qid}S`]?.response];
      }),
    });*/

    setUnansweredShown(missingRequiredMap);

    if (pendingBase) {
      const missingList = Object.keys(missingRequiredMap).length
        ? Object.keys(missingRequiredMap).join(', ')
        : missingRequired.join(', ');

      setSubmitAlert(
        `You cannot continue yet. Please answer all required questions before submitting. Missing: ${missingList}`
      );
      setIsSubmitting(false);
      return;
    }

    const blocked = computedState === 'inprogress';
    const canAdvance = computedState === 'complete';

    const attempt = {
      submissionString: groupSubmissionString,
      blocked,
      canAdvance,
      unanswered: [...missingRequired, ...pendingRevision],
      missingRequired,
      pendingRevision,
      answers,
    };

    if (!canPersistSubmissions) {
      setExistingAnswers((prev) => {
        const next = { ...prev };
        Object.entries(answers).forEach(([key, value]) => {
          next[key] = {
            ...(next[key] || {}),
            response: value,
            type: 'text',
          };
        });
        return next;
      });
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/submit-group`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            studentId: user.id,
            groupNum,
            retriesRequired,
            forceOverride: !!forceOverride,
            attempt,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        alert(`Submission failed: ${errorData.error || 'Unknown error'}`);
        setIsSubmitting(false);
        return;
      }

      const result = await response.json().catch(() => ({}));
      const priorCompletedGroups = Number(activity?.completed_groups ?? 0);
      const resultCompletedGroups =
        result?.completed_groups != null ? Number(result.completed_groups) : null;
      const advancedByServer =
        Number.isFinite(resultCompletedGroups) &&
        resultCompletedGroups > priorCompletedGroups;

       setActivity((prev) => (
        prev
          ? {
              ...prev,
              ...(Number.isFinite(resultCompletedGroups)
                ? { completed_groups: resultCompletedGroups }
                : {}),
              ...(result?.progress_status
                ? { progress_status: result.progress_status }
                : {}),
            }
          : prev
      ));

      if (Object.prototype.hasOwnProperty.call(result || {}, 'activeStudentId')) {
        setActiveStudentId(result.activeStudentId != null ? Number(result.activeStudentId) : null);
      }

      if (advancedByServer) {
        window.setTimeout(() => {
          loadActivity().catch((err) => {
            console.error('❌ Background reload after submit failed:', err);
          });
        }, 250);
      } else {
        await loadActivity();
      }

      const blockedByServer = !advancedByServer;

      if (blockedByServer) {
        //alert(
        //  `Your attempt was saved, but this group cannot advance yet.\n\n` +
        //  `Open the instructor history later to review the full attempt transcript.`
        //);
        setIsSubmitting(false);
        return;
      }


      setCanBypassGroups((prev) => {
        const next = { ...prev };
        delete next[submitGroupIndex];
        return next;
      });

      if (!isTestMode && forceOverride) {
        const qBlocksForGroup = blocks.filter((b) => b.type === 'question');
        setTextFeedbackShown((prev) => {
          const next = { ...prev };
          qBlocksForGroup.forEach((b) => {
            const qid = `${b.groupId}${b.id}`;
            delete next[qid];
          });
          return next;
        });
      }

      if (submitGroupIndex + 1 === groups.length) {
        await fetch(`${API_BASE_URL}/api/responses/mark-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ instanceId }),
        });
      }
    } catch (err) {
      console.error('❌ Submission failed:', err);
      alert('An error occurred during submission.');
    } finally {
      setIsSubmitting(false);
    }

    if (computedState === 'complete' && overrideThisGroup && pendingBase) {
      alert(
        'You chose to continue without addressing AI feedback. ' +
        'Your instructor may review this later.'
      );
    }

  } // END handleSubmit

  async function handleRegradeTest() {
    if (isSubmitting) return;
    if (!canRegradeTests) return;

    console.log('[REGRD] click', {
      t: Date.now(),
      instanceId,
      isTestMode,
      isInstructor,
      submitted_at: activity?.submitted_at,
      submitted_by_user_id: activity?.submitted_by_user_id,
    });

    setIsSubmitting(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const studentId = activity?.submitted_by_user_id || null;

      const blocks = groups.flatMap((g) => [g.intro, ...(g.content || [])]);

      const answers = {};
      const questions = [];

      for (const block of blocks) {
        if (block?.type !== 'question') continue;

        const qid = `${block.groupId}${block.id}`;
        const questionText = getQuestionText(block, qid);

        const responseText = String(existingAnswers?.[qid]?.response ?? '').trim();

        const codeKeys = Object.keys(existingAnswers || {})
          .filter((k) => k.toLowerCase().startsWith(`${qid}code`))
          .sort();

        codeKeys.forEach((k) => { answers[k] = String(existingAnswers?.[k]?.response ?? ''); });

        const outputKey = `${qid}output`;
        const outputText = String(existingAnswers?.[outputKey]?.response ?? '').trim();
        if (outputText) answers[outputKey] = outputText;

        answers[qid] = responseText;

        const codeCells = codeKeys
          .map((k) => {
            const code = String(existingAnswers?.[k]?.response ?? '');
            return { code, lang: pickLangForBlock(block, code), label: k };
          })
          .filter((c) => c.code.trim() !== '');

        questions.push({ qid, questionText, scores: block.scores || {}, responseText, codeCells, outputText });
      }

      console.log('[REGRD] about to POST', {
        url: `${API_BASE_URL}/api/activity-instances/${instanceId}/submit-test`,
        studentId,
        answersCount: Object.keys(answers).length,
        questionsCount: questions.length,
      });

      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/submit-test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({
            studentId,
            regrade: true,
            answers,
            questions,
          }),
        }
      );

      const raw = await res.text();
      console.log('[REGRD] response', { ok: res.ok, status: res.status, rawHead: raw.slice(0, 200) });

      if (!res.ok) {
        alert(`Regrade failed: ${raw.slice(0, 200) || 'Unknown error'}`);
        return;
      }

      await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/recompute-test-totals`, {
        method: 'POST',
        credentials: 'include',
      });
      await loadActivity();

      alert('Regrade complete.');
    } catch (e) {
      console.error('[REGRD] error', e);
      alert(e?.name === 'AbortError' ? 'Regrade timed out (20s).' : 'Regrade failed.');
    } finally {
      clearTimeout(timeoutId);
      setIsSubmitting(false);
      console.log('[REGRD] done');
    }
  }
  // Instructor override: save edited per-question scores & feedback
  async function handleSaveQuestionScores(qid, local) {
    if (!activity || !instanceId || !user?.id) return;
    if (!canSaveInstructorScores) return;

    const answers = {};

    // Normalize numeric scores (allow blank to mean "no score")
    const toNumOrNull = (val) => {
      if (val === '' || val == null) return '';
      const n = Number(val);
      return Number.isNaN(n) ? '' : String(n);
    };

    answers[`${qid}ResponseScore`] = toNumOrNull(local.respScore);
    answers[`${qid}RunScore`] = toNumOrNull(local.runScore);
    answers[`${qid}CodeScore`] = toNumOrNull(local.codeScore);

    // Free-text feedback
    answers[`${qid}ResponseFeedback`] = local.respExplain ?? '';
    answers[`${qid}RunFeedback`] = local.runExplain ?? '';
    answers[`${qid}CodeFeedback`] = local.codeExplain ?? '';

    try {
      // Persist overrides to DB
      await fetch(`${API_BASE_URL}/api/responses/bulk-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          instanceId,
          userId: user.id,
          answers,
        }),
      });

      // Update local state so UI reflects changes immediately
      setExistingAnswers((prev) => {
        const next = { ...prev };

        Object.entries(answers).forEach(([key, value]) => {
          next[key] = {
            ...(next[key] || {}),
            response: value,
            type: 'text',
          };
        });

        return next;
      });

      // Optionally you could recompute overall totals or reload activity,
      // but typically this is enough:
      // await loadActivity();   // <- if you want to be extra sure

      alert(`Saved updated scores/feedback for ${qid}.`);
    } catch (err) {
      console.error('Failed to save question scores:', err);
      alert('Error saving updated scores. Please try again.');
    }
  }

  // Helper: tri-band scores + feedback for a base question id like "1a"
  function getQuestionScores(qid, block) {
    const codeScoreRaw =
      existingAnswers[`${qid}CodeScore`]?.response ??
      existingAnswers[`${qid}codeScore`]?.response;

    const runScoreRaw =
      existingAnswers[`${qid}RunScore`]?.response ??
      existingAnswers[`${qid}runScore`]?.response;

    const respScoreRaw =
      existingAnswers[`${qid}ResponseScore`]?.response ??
      existingAnswers[`${qid}responseScore`]?.response;

    const codeScore = codeScoreRaw != null ? Number(codeScoreRaw) : null;
    const runScore = runScoreRaw != null ? Number(runScoreRaw) : null;
    const respScore = respScoreRaw != null ? Number(respScoreRaw) : null;

    const codeExplain =
      existingAnswers[`${qid}CodeFeedback`]?.response ||
      existingAnswers[`${qid}CodeExplain`]?.response ||
      '';

    const runExplain =
      existingAnswers[`${qid}RunFeedback`]?.response ||
      existingAnswers[`${qid}RunExplain`]?.response ||
      '';

    const respExplain =
      existingAnswers[`${qid}ResponseFeedback`]?.response ||
      existingAnswers[`${qid}ResponseExplain`]?.response ||
      '';

    const bucketPoints = (bucket) => {
      if (!bucket) return 0;
      if (typeof bucket === 'number') return bucket;
      if (typeof bucket === 'object' && typeof bucket.points === 'number') {
        return bucket.points;
      }
      return 0;
    };

    const scores = block?.scores || {};
    const maxCode = bucketPoints(scores.code);
    const maxRun = bucketPoints(scores.output);
    const maxResp = bucketPoints(scores.response);

    const hasAnyScore =
      codeScoreRaw != null ||
      runScoreRaw != null ||
      respScoreRaw != null ||
      Object.prototype.hasOwnProperty.call(existingAnswers, `${qid}CodeScore`) ||
      Object.prototype.hasOwnProperty.call(existingAnswers, `${qid}RunScore`) ||
      Object.prototype.hasOwnProperty.call(
        existingAnswers,
        `${qid}ResponseScore`
      );

    const earnedTotal =
      (codeScore != null ? codeScore : 0) +
      (runScore != null ? runScore : 0) +
      (respScore != null ? respScore : 0);

    const maxTotal = maxCode + maxRun + maxResp;

    return {
      hasAnyScore,
      codeScore,
      runScore,
      respScore,
      codeExplain,
      runExplain,
      respExplain,
      maxCode,
      maxRun,
      maxResp,
      earnedTotal,
      maxTotal,
    };
  }

  const isSubmitted = !!activity?.submitted_at;


  return (
    <>
      <ActivityLoadingOverlay
        show={isSubmitting}
      />
      <Container className="pt-3 mt-2">
        <h2>
          {activity?.title
            ? `Activity: ${activity.title}`
            : courseName
              ? `Course: ${courseName}`
              : 'Untitled Activity'}
        </h2>

        <RunActivityTestStatusBanner
          isTestMode={isTestMode}
          testWindow={testWindow}
          testLockState={testLockState}
          isStudent={isStudent}
          submittedAt={activity?.submitted_at}
          formatRemainingSeconds={formatRemainingSeconds}
        />

        {canViewHistory && (
          <div className="d-flex align-items-center justify-content-between mb-3">
            <div>
              <strong>View:</strong>
            </div>
            <ButtonGroup size="sm">
              <Button
                variant={viewMode === 'latest' ? 'primary' : 'outline-primary'}
                onClick={() => setViewMode('latest')}
              >
                Current View
              </Button>
              <Button
                variant={viewMode === 'history' ? 'primary' : 'outline-primary'}
                onClick={() => setViewMode('history')}
              >
                History View
              </Button>
            </ButtonGroup>
          </div>
        )}
        {submitAlert && (
          <Alert
            variant="warning"
            dismissible
            onClose={() => setSubmitAlert(null)}
            className="mt-3"
          >
            {submitAlert}
          </Alert>
        )}
        {effectiveViewMode === 'history' ? (
          <RunActivityHistoryView
            historyRows={historyRows}
            groups={groups}
            userNameById={Object.fromEntries(
              (groupMembers || []).map((m) => [m.student_id, m.name])
            )}
            title="Full Submission History"
          />
        ) : (
          <RunActivityWorkspace
            activityPaused={activityPaused}
            renderBlocks={renderBlocks}
            preamble={preamble}
            codeFeedbackShown={codeFeedbackShown}
            unansweredShown={unansweredShown}
            isInstructor={isInstructor}
            isActive={isActive}
            toggleCodeViewMode={toggleCodeViewMode}
            updateLocalCode={updateLocalCode}
            existingAnswers={existingAnswers}
            fileContents={fileContents}
            handleUpdateFileContents={handleUpdateFileContents}
            handleFileChange={handleFileChange}
            groups={groups}
            activity={activity}
            isTestMode={isTestMode}
            isStudent={isStudent}
            isSubmitted={isSubmitted}
            timeExpired={timeExpired}
            testLockState={testLockState}
            socket={socket}
            instanceId={instanceId}
            user={user}
            handleCodeChange={handleCodeChange}
            baseQidFromResponseKey={baseQidFromResponseKey}
            isObserver={isObserver}
            isSandbox={isSandbox}
            allowFreeNavigation={allowFreeNavigation}
            canEditAnswers={canEditAnswers}
            canSubmitGroup={canSubmitGroup}
            canSubmitTest={canSubmitTest}
            canRegradeTests={canRegradeTests}
            canSaveInstructorScores={canSaveInstructorScores}
            sandboxGroupIndex={sandboxGroupIndex}
            setSandboxGroupIndex={setSandboxGroupIndex}
            codeViewMode={codeViewMode}
            localCode={localCode}
            handleTextChange={handleTextChange}
            textFeedbackShown={textFeedbackShown}
            nonLegacyForUI={nonLegacyForUI}
            getQuestionScores={getQuestionScores}
            handleSaveQuestionScores={handleSaveQuestionScores}
            handleSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            isPlaygroundMode={isPlaygroundMode}
            canBypassGroups={canBypassGroups}
            handleRegradeTest={handleRegradeTest}
            overallTestTotals={overallTestTotals}
            infoBubbleSession={infoBubbleSessionRef.current}
          />
        )}
      </Container>

      {DEBUG_FILES && (
        <div className="small text-muted" style={{ whiteSpace: 'pre-wrap' }}>
          <strong>🧪 Files:</strong>{' '}
          {Object.keys(fileContents).length === 0
            ? '(none)'
            : Object.entries(fileContents)
              .map(([k, v]) => `${k}(${(v ?? '').length})`)
              .join(', ')}
        </div>
      )}



      <RunActivityFloatingTimer
        isTestMode={isTestMode}
        isStudent={isStudent}
        testWindow={testWindow}
        testLockState={testLockState}
        submittedAt={activity?.submitted_at}
        formatRemainingSeconds={formatRemainingSeconds}
        sectionTimer={sectionTimer}
      />

    </>
  );
}
