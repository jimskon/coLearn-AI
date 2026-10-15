import React, { useEffect, useMemo, useRef, useState } from 'react';
import { InlineAiAssistBlock, aiBaseQidFor, readAiTranscript } from '../../utils/parseSheet';

// pct is the activity's share of the width; the AI panel gets the rest.
// The key was renamed when the default changed so earlier saved splits
// (often the AI at 75%) don't override the new default.
const SPLIT_STORAGE_KEY = 'colearn.activity.aiSplitPct.v2';
const MIN_PCT = 25;
const MAX_PCT = 75;
const DEFAULT_PCT = 75; // AI panel takes 25% by default

function clampPct(value) {
  if (!Number.isFinite(value)) return DEFAULT_PCT;
  return Math.min(MAX_PCT, Math.max(MIN_PCT, value));
}

// Flattens every \ai block in the activity, carrying the context each one needs
// to render in the side panel and to decide whether it may be used right now.
export function collectAiEntries(groups) {
  const entries = [];

  (groups || []).forEach((group, groupIndex) => {
    const visit = (blocks) => {
      (blocks || []).forEach((block) => {
        if (!block) return;

        // Group-level panel, not attached to a question.
        if (block.type === 'ai') {
          entries.push({ groupIndex, question: null, aiBlock: block });
          return;
        }

        if (block.type === 'question' && block.aiBlocks?.length) {
          block.aiBlocks.forEach((aiBlock) => {
            entries.push({ groupIndex, question: block, aiBlock });
          });
        }
      });
    };

    visit(group?.prelude);
    visit(group?.content);
  });

  return entries;
}

// Horizontal split with a draggable divider.
//
// Pointer events cover mouse, touch, and pen, so the divider also drags on
// tablets. The pointer is tracked on `window` rather than on the divider so a
// fast drag that outruns the cursor or finger does not drop the gesture, and
// the width is stored per browser so the balance a user picks survives a reload.
export function useSplitPane(enabled) {
  const [pct, setPct] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_PCT;
    try {
      const saved = window.localStorage.getItem(SPLIT_STORAGE_KEY);
      return saved == null ? DEFAULT_PCT : clampPct(Number(saved));
    } catch {
      return DEFAULT_PCT;
    }
  });
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!enabled || !dragging) return undefined;

    const handleMove = (event) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect?.width) return;
      setPct(clampPct(((event.clientX - rect.left) / rect.width) * 100));
    };
    const handleUp = () => setDragging(false);

    // Stop text selection while dragging.
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [enabled, dragging]);

  useEffect(() => {
    if (dragging || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(pct)));
    } catch {
      // Private browsing or storage disabled: the split just won't persist.
    }
  }, [pct, dragging]);

  // Arrow keys move the divider so it is usable without a mouse.
  const handleKeyDown = (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPct((current) => clampPct(current - 2));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPct((current) => clampPct(current + 2));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPct(DEFAULT_PCT);
    }
  };

  return { pct, dragging, setDragging, containerRef, handleKeyDown };
}

export function SplitDivider({ pct, dragging, onStart, onKeyDown }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize activity and AI panel"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={MIN_PCT}
      aria-valuemax={MAX_PCT}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        onStart();
      }}
      onKeyDown={onKeyDown}
      className="d-flex align-items-center justify-content-center flex-shrink-0"
      style={{
        width: 14, // wide enough to grab with a finger
        cursor: 'col-resize',
        touchAction: 'none', // a touch drag resizes instead of scrolling the page
        background: dragging ? '#adb5bd' : '#dee2e6',
        borderRadius: 2,
        alignSelf: 'stretch',
      }}
    >
      <div className="d-flex flex-column" style={{ gap: 3 }} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((dot) => (
          <span
            key={dot}
            style={{ width: 2, height: 2, borderRadius: '50%', background: '#6c757d', display: 'block' }}
          />
        ))}
      </div>
    </div>
  );
}

// The right-hand AI transcript. One continuous thread for the whole activity,
// separated by question, mirroring the order of the activity on the left.
export function ActivityAiPanel({
  entries,
  currentGroupIndex,
  isRevealed,
  isActive,
  isObserver,
  isInstructor,
  isSubmitted,
  isEnded = false,
  activityLanguage,
  instanceId,
  userId,
  existingAnswers,
  onAiTurnSaved,
  activeStudentName,
}) {
  const visible = useMemo(
    () => (entries || []).filter((entry) => isRevealed(entry.groupIndex)),
    [entries, isRevealed]
  );

  // The AI is usable only when the current question group actually contains an
  // AI block, and only for the active student. Instructors and other students
  // are observers of the thread, never participants in it.
  const currentGroupHasAi = (entries || []).some((entry) => entry.groupIndex === currentGroupIndex);
  const canAskAtAll = !!isActive && !isObserver && !isInstructor && !isSubmitted && !isEnded && currentGroupHasAi;

  let lockReason = '';
  if (isEnded) {
    lockReason = 'This activity has ended. The transcript is read only.';
  } else if (isSubmitted) {
    lockReason = 'This activity has been submitted. The transcript is read only.';
  } else if (isInstructor || isObserver) {
    lockReason = activeStudentName
      ? `Only ${activeStudentName} can ask. If control passes to you, this thread continues.`
      : 'Only the active student can ask. If control passes to you, this thread continues.';
  } else if (!currentGroupHasAi) {
    lockReason = 'This question does not use the AI assistant. Earlier exchanges stay readable above.';
  }

  return (
    <div className="d-flex flex-column h-100">
      <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-light flex-shrink-0">
        <strong className="small">AI Assistant</strong>
        {canAskAtAll ? (
          <span className="badge rounded-pill bg-success-subtle text-success-emphasis border border-success-subtle">
            Open
          </span>
        ) : (
          <span className="badge rounded-pill bg-secondary-subtle text-secondary-emphasis border">
            {isEnded ? 'Ended' : isSubmitted ? 'Submitted' : (isInstructor || isObserver) ? 'Read only' : 'Closed here'}
          </span>
        )}
      </div>

      <div className="flex-grow-1 overflow-auto px-3 pb-3" style={{ minHeight: 0 }}>
        {visible.length ? (
          visible.map((entry, index) => {
            const askable = canAskAtAll && entry.groupIndex === currentGroupIndex;
            const baseQid = aiBaseQidFor(entry.aiBlock, entry.question);
            const label = entry.question
              ? `Question ${entry.groupIndex + 1}${entry.question.id}`
              : `Question group ${entry.groupIndex + 1}`;

            return (
              <div key={`ai-entry-${entry.groupIndex}-${entry.aiBlock.previewKey}-${index}`}>
                <div className="d-flex align-items-center gap-2 mt-3">
                  <hr className="flex-grow-1 my-0" />
                  <span
                    className={`small fw-semibold text-uppercase ${
                      entry.groupIndex === currentGroupIndex ? 'text-primary' : 'text-muted'
                    }`}
                    style={{ letterSpacing: '.03em' }}
                  >
                    {label}
                    {entry.groupIndex === currentGroupIndex ? ' · current' : ''}
                  </span>
                  <hr className="flex-grow-1 my-0" />
                </div>

                <div style={entry.groupIndex === currentGroupIndex ? undefined : { opacity: 0.75 }}>
                  <InlineAiAssistBlock
                    aiBlock={entry.aiBlock}
                    questionBlock={entry.question}
                    activityLanguage={activityLanguage}
                    runMode="run"
                    baseQid={baseQid}
                    instanceId={instanceId}
                    userId={userId}
                    transcript={readAiTranscript(existingAnswers, baseQid)}
                    canAsk={askable}
                    lockReason={lockReason}
                    onTurnSaved={onAiTurnSaved}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-muted small mt-3">
            AI help appears here when you reach a question that uses it.
          </div>
        )}
      </div>
    </div>
  );
}

export { MIN_PCT, MAX_PCT, DEFAULT_PCT };
