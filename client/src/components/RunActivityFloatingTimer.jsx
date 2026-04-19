// client/src/components/RunActivityFloatingTimer.jsx
import React from 'react';

export default function RunActivityFloatingTimer({
  isTestMode,
  isStudent,
  testWindow,
  testLockState,
  submittedAt,
  formatRemainingSeconds,
}) {
  if (!isTestMode || !isStudent || !testWindow) return null;

  const { lockedBefore, lockedAfter, remainingSeconds } = testLockState || {};

  return (
    <div
      style={{
        position: 'fixed',
        top: '70px',      // below the navbar
        right: '16px',
        zIndex: 1050,     // above page content but below modals
      }}
    >
      <div className="bg-dark text-white px-3 py-2 rounded shadow-sm small">
        {lockedBefore && (
          <>
            <div className="fw-bold">Test starts in</div>
            {remainingSeconds != null && (
              <div>{formatRemainingSeconds(remainingSeconds)}</div>
            )}
          </>
        )}

        {!lockedBefore &&
          !lockedAfter &&
          remainingSeconds != null && (
            <>
              <div className="fw-bold">Time remaining</div>
              <div>{formatRemainingSeconds(remainingSeconds)}</div>
            </>
          )}

        {lockedAfter && (
          <>
            <div className="fw-bold">Test closed</div>
            {submittedAt && (
              <div className="mt-1">Your test has been submitted.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
