import React from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import QuestionScorePanel from '../../components/QuestionScorePanel';
import InfoBubble from '../../components/activity/InfoBubble';
import { collectInfosForTarget } from '../../utils/parseSheet';
import useRuntimeFeatures from '../../hooks/useRuntimeFeatures';

function renderInfoStack(infos, keyPrefix, anchorRef, options = {}) {
  if (!infos?.length) return null;
  const target = options.target || infos[0]?.target;
  const infoBubbleSession = options.infoBubbleSession;
  const bubbleKey = `${keyPrefix}-${target}`;
  const firstInfo = infos[0];

  return (
    <InfoBubble
      key={bubbleKey}
      info={firstInfo}
      showKey={bubbleKey}
      anchorRef={anchorRef}
      placement={options.placement || 'top'}
      infoBubbleSession={infoBubbleSession}
    />
  );
}

function collectGroupInfos(group, target) {
  return collectInfosForTarget([group?.intro, group?.prelude, group?.content], target);
}

export default function RunActivityWorkspace({
  activityPaused,
  renderBlocks,
  preamble,
  codeFeedbackShown,
  unansweredShown,
  isInstructor,
  isActive,
  toggleCodeViewMode,
  updateLocalCode,
  existingAnswers,
  fileContents,
  handleUpdateFileContents,
  handleFileChange,
  groups,
  activity,
  isTestMode,
  isStudent,
  isSubmitted,
  timeExpired,
  testLockState,
  socket,
  instanceId,
  user,
  handleCodeChange,
  baseQidFromResponseKey,
  isObserver,
  isSandbox,
  allowFreeNavigation,
  canEditAnswers,
  canSubmitGroup,
  canSubmitTest,
  canRegradeTests,
  canSaveInstructorScores,
  codeViewMode,
  localCode,
  handleTextChange,
  textFeedbackShown,
  nonLegacyForUI,
  getQuestionScores,
  handleSaveQuestionScores,
  handleSubmit,
  isSubmitting,
  isPlaygroundMode,
  canBypassGroups,
  handleRegradeTest,
  overallTestTotals,
  infoBubbleSession,
}) {
  const { features: runtimeFeatures } = useRuntimeFeatures();
  let globalQuestionCounter = 0;

  return (
    <div style={{ position: 'relative' }}>
      {activityPaused && (
        <div
          className="d-flex align-items-center justify-content-center"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            background: 'rgba(255,255,255,0.45)',
            backdropFilter: 'grayscale(0.15)',
          }}
        >
          <div className="px-3 py-2 rounded border bg-light text-muted fw-semibold shadow-sm">
            Paused
          </div>
        </div>
      )}
      <div
        aria-disabled={activityPaused ? 'true' : undefined}
        style={activityPaused ? { pointerEvents: 'none', userSelect: 'none' } : undefined}
      >
        {isSandbox && (
          <Alert variant="secondary" className="mb-3">
            Sandbox mode is using the shared activity workspace with local edits only.
          </Alert>
        )}

        {renderBlocks(preamble, {
          editable: false,
          isActive: false,
          mode: 'run',
          codeFeedbackShown,
          unansweredShown,
          isInstructor,
          allowLocalToggle: true,
          isObserver: !isActive,
          codeViewMode,
          onToggleViewMode: toggleCodeViewMode,
          localCode,
          onLocalCodeChange: updateLocalCode,
          prefill: existingAnswers,
          fileContents,
          setFileContents: handleUpdateFileContents,
          onFileChange: handleFileChange,
          infoBubbleSession,
          runtimeFeatures,
        })}

        {groups.map((group, index) => {
          const questionGroupAnchorRef = React.createRef();
          const submitAnchorRef = React.createRef();
          const completedCount = Number(activity?.completed_groups ?? 0);
          const isComplete = index < completedCount;
          const isCurrent = index === completedCount;

          const testEditable =
            canEditAnswers &&
            isTestMode &&
            isStudent &&
            !isSubmitted &&
            !timeExpired &&
            !testLockState.lockedBefore;

          const editable = isSandbox
            ? canEditAnswers
            : isTestMode
            ? testEditable
            : (canEditAnswers && isActive && isCurrent && !isComplete);

          const showGroup =
            isSandbox
              ? true
              : (
            isTestMode
              ? true
              : (isInstructor || isComplete || isCurrent)
              );

          if (!showGroup) return null;

          return (
            <div
              key={`group-${index}`}
              className="mb-4"
              data-current-group={editable ? 'true' : undefined}
              data-sandbox-group={isSandbox ? String(index) : undefined}
            >
              {group.prelude?.length > 0 &&
                renderBlocks(group.prelude, {
                  editable: false,
                  isActive: false,
                  mode: 'run',
                  prefill: existingAnswers,
                  currentGroupIndex: index,
                  codeFeedbackShown,
                  unansweredShown,
                  infoBubbleSession,
                  runtimeFeatures,
                })}

              <p ref={questionGroupAnchorRef}>
                <strong>{index + 1}.</strong> {group.intro.content}
              </p>
              {renderInfoStack(
                collectGroupInfos(group, 'questiongroup'),
                `group-${index}-questiongroup`,
                questionGroupAnchorRef,
                { target: 'questiongroup', infoBubbleSession }
              )}

              {group.content.map((block, bIndex) => {
                const renderedBlock = renderBlocks([block], {
                  editable,
                  isActive,
                  mode: 'run',
                  prefill: existingAnswers,
                  currentGroupIndex: index,
                  textFeedbackShown,
                  unansweredShown,
                  socket,
                  instanceId,
                  answeredBy: user?.id,
                  fileContents,
                  setFileContents: handleUpdateFileContents,
                  onFileChange: handleFileChange,
                  onCodeChange: (responseKey, code, extra) =>
                    handleCodeChange(responseKey, code, {
                      ...extra,
                      socket,
                      baseQidFromResponseKey,
                    }),
                  codeFeedbackShown,
                  isInstructor,
                  allowLocalToggle: true,
                  isObserver,
                  codeViewMode,
                  onToggleViewMode: toggleCodeViewMode,
                  localCode,
                  onLocalCodeChange: updateLocalCode,
                  onTextChange: (responseKey, value) =>
                    handleTextChange(responseKey, value, {
                      baseQidFromResponseKey,
                      socket,
                    }),
                  infoBubbleSession,
                  runtimeFeatures,
                });

                if (!isTestMode || block.type !== 'question') {
                  return (
                    <div key={`group-${index}-block-${bIndex}`}>
                      {renderedBlock}
                    </div>
                  );
                }

                const qid = `${block.groupId}${block.id}`;
                globalQuestionCounter += 1;
                const scores = getQuestionScores(qid, block);

                const allowEdit =
                  canSaveInstructorScores &&
                  isTestMode &&
                  isInstructor &&
                  isSubmitted;
                const showScorePanel =
                  isTestMode &&
                  (isInstructor || isSubmitted);
                const displayNumber = nonLegacyForUI ? qid : globalQuestionCounter;

                return (
                  <div key={`group-${index}-block-${bIndex}`} className="mb-2">
                    {renderedBlock}

                    {showScorePanel && (
                      <QuestionScorePanel
                        qid={qid}
                        displayNumber={displayNumber}
                        scores={scores}
                        allowEdit={allowEdit}
                        onSave={handleSaveQuestionScores}
                      />
                    )}
                  </div>
                );
              })}

              {isSandbox && canSubmitGroup && (
                <div className="mt-2" ref={submitAnchorRef}>
                  {renderInfoStack(
                    collectGroupInfos(group, 'submitbutton'),
                    `group-${index}-submitbutton`,
                    submitAnchorRef,
                    { target: 'submitbutton', infoBubbleSession }
                  )}
                  <Button onClick={() => handleSubmit(false, index)} disabled={isSubmitting}>
                    {isSubmitting ? 'Checking…' : 'Submit Group'}
                  </Button>
                </div>
              )}

              {isSandbox && (() => {
                const questionBlocks = group.content.filter((b) => b?.type === 'question');
                if (!questionBlocks.length) return null;
                const statuses = questionBlocks.map((b) => {
                  const qid = `${b.groupId}${b.id}`;
                  return String(existingAnswers?.[`${qid}S`]?.response || '').toLowerCase();
                });
                const allAccepted = statuses.length > 0 && statuses.every((s) => s === 'complete');
                const anyEvaluated = statuses.some(Boolean);
                if (!anyEvaluated) return null;
                return (
                  <Alert variant={allAccepted ? 'success' : 'warning'} className="mt-2">
                    {allAccepted ? 'Accepted' : 'Needs revision'}
                  </Alert>
                );
              })()}

              {editable && canSubmitGroup && !isTestMode && !isSandbox && (
                <div className="mt-2">
                  <Button onClick={() => handleSubmit(false)} disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Loading...
                      </>
                    ) : isPlaygroundMode ? (
                      'Next'
                    ) : (
                      'Submit and Continue'
                    )}
                  </Button>

                  {!isPlaygroundMode && canBypassGroups[index] === true && (
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="ms-2"
                      onClick={() => handleSubmit(true)}
                    >
                      Continue without addressing AI feedback
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {canSubmitTest && isTestMode && isStudent && !isSandbox && timeExpired && !isSubmitted && (
          <Alert variant="warning" className="mt-3">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <strong>Time is up.</strong> Your test is now locked. Press Submit to record your answers.
              </div>
              <Button onClick={() => handleSubmit(false)} disabled={isSubmitting}>
                {isSubmitting ? 'Submitting…' : 'Submit Test'}
              </Button>
            </div>
          </Alert>
        )}

        {canSubmitTest && isTestMode && isStudent && !isSandbox && !timeExpired && !isSubmitted && (
          <div className="mt-3">
            <Button onClick={() => handleSubmit(false)} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Submitting...
                </>
              ) : (
                'Submit Test'
              )}
            </Button>
          </div>
        )}

        {canRegradeTests && isTestMode && isInstructor && !isSandbox && isSubmitted && (
          <div className="mt-3 d-flex gap-2">
            <Button
              variant="warning"
              onClick={() => handleRegradeTest()}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Regrading…' : 'Regrade Test'}
            </Button>
          </div>
        )}

        {groups.length > 0 && Number(activity?.completed_groups ?? 0) >= groups.length && (
          <Alert variant="success" className="mt-3">
            Activity is complete! Review your responses above.
          </Alert>
        )}

        {isTestMode && !isSandbox && overallTestTotals.max > 0 && (isInstructor || isSubmitted) && (
          <Alert variant="info" className="mt-3">
            Overall test score:{' '}
            <strong>
              {overallTestTotals.earned}/{overallTestTotals.max}
            </strong>{' '}
            (
            {(
              (overallTestTotals.earned / overallTestTotals.max) *
              100
            ).toFixed(1)}
            %)
          </Alert>
        )}
      </div>
    </div>
  );
}
