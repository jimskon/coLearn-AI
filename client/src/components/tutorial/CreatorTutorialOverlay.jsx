import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'react-bootstrap';

const STORAGE_KEY = 'creator-workbench-tutorial-v1';

function getRect(targetRef) {
  const el = targetRef?.current;
  if (!el) return null;
  return el.getBoundingClientRect();
}

function computeBubblePosition(rect) {
  if (!rect) {
    return {
      top: 120,
      left: 24,
      arrowLeft: 40,
    };
  }

  const bubbleWidth = 330;
  const margin = 16;

  let left = rect.left;
  if (left + bubbleWidth > window.innerWidth - margin) {
    left = window.innerWidth - bubbleWidth - margin;
  }
  if (left < margin) left = margin;

  const top = Math.min(rect.bottom + 16, window.innerHeight - 180);

  return {
    top,
    left,
    arrowLeft: Math.max(24, rect.left + rect.width / 2 - left - 8),
  };
}

export function useCreatorTutorial({ demoMode = false } = {}) {
  const [phase, setPhase] = useState(() => {
    const pending = sessionStorage.getItem(`${STORAGE_KEY}:pending`);
    if (pending === 'after-generate') {
      sessionStorage.removeItem(`${STORAGE_KEY}:pending`);
      return 'after-generate';
    }

    if (demoMode) {
      return 'setup';
    }

    const completed = localStorage.getItem(STORAGE_KEY) === 'done';
    return completed ? 'off' : 'setup';
  });

  const quit = useCallback(() => {
    if (!demoMode) {
      localStorage.setItem(STORAGE_KEY, 'done');
    }
    sessionStorage.removeItem(`${STORAGE_KEY}:pending`);
    setPhase('off');
  }, [demoMode]);

  const finishSetup = useCallback(() => {
    setPhase('setup-done');
  }, []);

  const startAfterGenerate = useCallback(() => {
    sessionStorage.setItem(`${STORAGE_KEY}:pending`, 'after-generate');
    setPhase('after-generate');
  }, []);

  const resetTutorial = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(`${STORAGE_KEY}:pending`);
    setPhase('setup');
  }, []);

  return {
    phase,
    quit,
    finishSetup,
    startAfterGenerate,
    resetTutorial,
  };
}

export default function CreatorTutorialOverlay({
  phase,
  refs,
  onQuit,
  onFinishSetup,
}) {
  const steps = useMemo(() => {
    if (phase === 'setup') {
      return [
        {
          key: 'title',
          targetRef: refs.title,
          title: 'Activity title',
          body: 'Enter a title for the activity you would like to create.',
        },
        {
          key: 'minutes',
          targetRef: refs.minutes,
          title: 'Activity length',
          body: 'Set the activity length in minutes.',
        },
        {
          key: 'brief',
          targetRef: refs.brief,
          title: 'Creator brief',
          body: 'Describe the activity in as much detail as you want. The more context you give, the better the draft will be.',
        },
      ];
    }

    if (phase === 'after-generate') {
      return [
        ...(demoMode ? [{
          key: 'class-link',
          targetRef: refs.classLink,
          title: 'Open the class page',
          body: 'From the class page, click View Groups to see the active class for this demo.',
        }] : []),
        {
          key: 'sandbox',
          targetRef: refs.sandbox,
          title: 'Try it as a student',
          body: 'Open the sandbox to try the activity out like a student.',
        },
        {
          key: 'revision',
          targetRef: refs.revision,
          title: 'Request changes',
          body: 'Use the revision box to request changes to the activity.',
        },
      ];
    }

    return [];
  }, [phase, refs, demoMode]);

  const [stepIndex, setStepIndex] = useState(0);
  const [position, setPosition] = useState(() => computeBubblePosition(null));

  const currentStep = steps[stepIndex];

  useEffect(() => {
    setStepIndex(0);
  }, [phase]);

  useEffect(() => {
    if (!currentStep) return undefined;

    const update = () => {
      const rect = getRect(currentStep.targetRef);
      setPosition(computeBubblePosition(rect));
    };

    update();

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    const timer = setTimeout(update, 50);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [currentStep]);

  if (!currentStep) return null;

  const targetRect = getRect(currentStep.targetRef);
  const isLastStep = stepIndex >= steps.length - 1;

  const handleNext = () => {
    if (!isLastStep) {
      setStepIndex((prev) => prev + 1);
      return;
    }

    if (phase === 'setup') {
      onFinishSetup();
    } else {
      onQuit();
    }
  };

  return (
    <>
      <style>{`
        .creator-tutorial-scrim {
          position: fixed;
          inset: 0;
          z-index: 1999;
          background: rgba(9, 21, 36, 0.18);
          pointer-events: none;
        }

        .creator-tutorial-highlight {
          position: fixed;
          z-index: 2000;
          border: 3px solid #4f8cff;
          border-radius: 10px;
          box-shadow: 0 0 0 9999px rgba(9, 21, 36, 0.18);
          pointer-events: none;
        }

        .creator-tutorial-bubble {
          position: fixed;
          z-index: 2001;
          width: 330px;
          max-width: calc(100vw - 32px);
          background: linear-gradient(135deg, #eef5ff, #ffffff);
          border: 1px solid #b8d4ff;
          border-radius: 16px;
          box-shadow: 0 14px 35px rgba(20, 45, 85, 0.25);
          padding: 1rem;
        }

        .creator-tutorial-arrow {
          position: absolute;
          top: -10px;
          width: 20px;
          height: 20px;
          background: #eef5ff;
          border-left: 1px solid #b8d4ff;
          border-top: 1px solid #b8d4ff;
          transform: rotate(45deg);
        }

        .creator-tutorial-title {
          font-weight: 700;
          font-size: 1rem;
          margin-bottom: 0.35rem;
          color: #17345c;
        }

        .creator-tutorial-body {
          color: #26384d;
          font-size: 0.94rem;
          line-height: 1.35;
        }
      `}</style>

      <div className="creator-tutorial-scrim" />

      {targetRect ? (
        <div
          className="creator-tutorial-highlight"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      ) : null}

      <div
        className="creator-tutorial-bubble"
        style={{
          top: position.top,
          left: position.left,
        }}
      >
        <div
          className="creator-tutorial-arrow"
          style={{
            left: position.arrowLeft,
          }}
        />

        <div className="creator-tutorial-title">{currentStep.title}</div>
        <div className="creator-tutorial-body mb-3">{currentStep.body}</div>

        <div className="d-flex justify-content-between align-items-center">
          <div className="text-muted small">
            {stepIndex + 1} of {steps.length}
          </div>

          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-secondary" onClick={onQuit}>
              Quit
            </Button>
            <Button size="sm" variant="primary" onClick={handleNext}>
              {isLastStep ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
