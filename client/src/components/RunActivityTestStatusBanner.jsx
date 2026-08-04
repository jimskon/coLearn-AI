// client/src/components/RunActivityTestStatusBanner.jsx
import React from 'react';
import { Alert } from 'react-bootstrap';

export default function RunActivityTestStatusBanner({
  isTestMode,
  testWindow,
  testLockState,
  isStudent,
  submittedAt,
  reviewComplete = false,
  score,
  formatRemainingSeconds,
}) {
  if (!isTestMode) return null;

  const { lockedBefore, lockedAfter, remainingSeconds } = testLockState || {};
  const earned = Number(score?.earned);
  const possible = Number(score?.max);
  const hasScore = Number.isFinite(earned) && Number.isFinite(possible) && possible > 0;
  const percentage = hasScore ? ((earned / possible) * 100).toFixed(1) : null;

  return (
    <Alert
      variant={
        lockedAfter
          ? 'secondary'
          : lockedBefore
          ? 'warning'
          : 'info'
      }
      className="mt-2"
    >
      <div>
        <strong>This is a timed test.</strong>
      </div>

      {testWindow && (
        <div className="small mt-1">
          Start:{' '}
          <strong>{testWindow.start.toLocaleString()}</strong>
          &nbsp;–&nbsp;
          End:{' '}
          <strong>{testWindow.end.toLocaleString()}</strong>
        </div>
      )}

      {isStudent && lockedBefore && (
        <div className="small mt-1">
          The test has not started yet. It will unlock at the start time.
        </div>
      )}

      {isStudent &&
        !lockedBefore &&
        !lockedAfter &&
        remainingSeconds != null && (
          <div className="small mt-1">
            Time remaining:{' '}
            <strong>{formatRemainingSeconds(remainingSeconds)}</strong>
          </div>
        )}

      {isStudent && lockedAfter && (
        <div className="small mt-1">
          The test window is closed
          {submittedAt ? ' and your test has been submitted.' : '.'}
        </div>
      )}

      {isStudent && submittedAt && hasScore && (
        <div className="mt-3 pt-2 border-top">
          <strong>{reviewComplete ? 'Reviewed by instructor' : 'Preliminary score — pending instructor review'}</strong>
          <div className="mt-1">
            Score: <strong>{earned}/{possible}</strong> ({percentage}%)
          </div>
        </div>
      )}
    </Alert>
  );
}
