export const INFO_PRIORITY = [
  'textresponse',
  'coderesponse',
  'aifeedback',
  'submitbutton',
  'question',
  'questiongroup',
];

export function normalizeInfoBubbleTarget(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function getInfoBubblePriority(target) {
  const normalized = normalizeInfoBubbleTarget(target);
  const index = INFO_PRIORITY.indexOf(normalized);
  return index >= 0 ? index : INFO_PRIORITY.length;
}

function compareCandidates(a, b) {
  const priorityDelta = getInfoBubblePriority(a?.target) - getInfoBubblePriority(b?.target);
  if (priorityDelta !== 0) return priorityDelta;
  const orderDelta = Number(a?.order || 0) - Number(b?.order || 0);
  if (orderDelta !== 0) return orderDelta;
  return String(a?.key || '').localeCompare(String(b?.key || ''));
}

export function pickInfoToShow(candidates = [], seenTargets = new Set()) {
  const seen = seenTargets instanceof Set ? seenTargets : new Set(seenTargets || []);
  return [...(Array.isArray(candidates) ? candidates : [])]
    .filter((candidate) => candidate?.target && !seen.has(normalizeInfoBubbleTarget(candidate.target)))
    .sort(compareCandidates)[0] || null;
}

export function createInfoBubbleSession() {
  const state = {
    seenTargets: new Set(),
    candidates: new Map(),
    activeKey: null,
    lockedKey: null,
    listeners: new Set(),
    nextOrder: 1,
  };

  const emit = () => {
    state.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // keep session notifications best-effort only
      }
    });
  };

  const recomputeActive = () => {
    if (state.lockedKey) {
      state.activeKey = state.lockedKey;
      emit();
      return;
    }
    const winner = pickInfoToShow([...state.candidates.values()], state.seenTargets);
    const nextActiveKey = winner?.key || null;
    if (nextActiveKey !== state.activeKey) {
      state.activeKey = nextActiveKey;
      emit();
      return;
    }
    emit();
  };

  state.subscribe = (listener) => {
    if (typeof listener !== 'function') return () => {};
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  };

  state.getActiveKey = () => state.activeKey;

  state.isTargetSeen = (target) => state.seenTargets.has(normalizeInfoBubbleTarget(target));

  state.markTargetSeen = (target) => {
    const normalized = normalizeInfoBubbleTarget(target);
    if (!normalized || state.seenTargets.has(normalized)) return false;
    state.seenTargets.add(normalized);
    emit();
    return true;
  };

  state.lockCandidate = (key) => {
    const candidate = state.candidates.get(key);
    if (!candidate) return false;
    state.lockedKey = key;
    state.activeKey = key;
    state.seenTargets.add(candidate.target);
    emit();
    return true;
  };

  state.registerCandidate = ({ key, target }) => {
    const normalizedTarget = normalizeInfoBubbleTarget(target);
    if (!key || !normalizedTarget) return () => {};

    state.candidates.set(key, {
      key,
      target: normalizedTarget,
      order: state.nextOrder++,
    });
    recomputeActive();

    return () => {
      if (state.candidates.delete(key)) {
        recomputeActive();
      }
    };
  };

  state.dismissCandidate = (key) => {
    const candidate = state.candidates.get(key);
    if (!candidate) return;
    if (state.lockedKey === key) {
      state.lockedKey = null;
    }
    if (state.activeKey === key) {
      state.activeKey = null;
    }
    state.seenTargets.add(candidate.target);
    recomputeActive();
  };

  return state;
}
