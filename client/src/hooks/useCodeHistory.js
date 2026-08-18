import { useCallback, useRef, useState } from 'react';

const DEFAULT_LIMIT = 150;

function asSnapshot(value, selection) {
  const text = String(value ?? '');
  const fallback = text.length;
  const start = Number.isFinite(selection?.start) ? selection.start : fallback;
  const end = Number.isFinite(selection?.end) ? selection.end : start;

  return {
    value: text,
    selection: {
      start: Math.max(0, Math.min(start, text.length)),
      end: Math.max(0, Math.min(end, text.length)),
    },
  };
}

// Code cells use controlled textareas and make programmatic edits for Tab and
// automatic indentation. Browser undo cannot reliably cover those edits, so
// keep a small local history for the current editor session. Remote activity
// updates call reset(), and are deliberately never made undoable.
export default function useCodeHistory(initialValue = '', { limit = DEFAULT_LIMIT } = {}) {
  const initialSnapshot = asSnapshot(initialValue);
  const pastRef = useRef([initialSnapshot]);
  const futureRef = useRef([]);
  const [, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setVersion((version) => version + 1);
  }, []);

  const record = useCallback((value, selection) => {
    const next = asSnapshot(value, selection);
    const current = pastRef.current.at(-1);
    if (current?.value === next.value) return;

    pastRef.current = [...pastRef.current, next].slice(-(Math.max(2, limit)));
    futureRef.current = [];
    refresh();
  }, [limit, refresh]);

  const undo = useCallback(() => {
    if (pastRef.current.length < 2) return null;

    const current = pastRef.current.at(-1);
    const previous = pastRef.current.at(-2);
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [current, ...futureRef.current];
    refresh();
    return previous;
  }, [refresh]);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return null;

    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, next];
    refresh();
    return next;
  }, [refresh]);

  const reset = useCallback((value, selection) => {
    pastRef.current = [asSnapshot(value, selection)];
    futureRef.current = [];
    refresh();
  }, [refresh]);

  return {
    record,
    undo,
    redo,
    reset,
    canUndo: pastRef.current.length > 1,
    canRedo: futureRef.current.length > 0,
  };
}
