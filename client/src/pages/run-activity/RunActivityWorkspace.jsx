import React from 'react';
import { Alert, Badge, Button, Spinner } from 'react-bootstrap';
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
  isCreatorTestRun,
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
  isCreatorSandbox,
  allowFreeNavigation,
  canEditAnswers,
  canSubmitGroup,
  canSubmitTest,
  canRegradeTests,
  canSaveInstructorScores,
  canGradeQuestionPreview,
  canGradeAllQuestions,
  gradingAllQuestions,
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
  questionGradePreviews,
  gradingQuestionQid,
  handleGradeSingleQuestion,
  handleGradeAllQuestions,
  clearQuestionGradePreview,
  infoBubbleSession,
  suppressStudentTestFeedbackUi = false,
  hideStudentTestSections = false,
}) {
  const { features: runtimeFeatures } = useRuntimeFeatures();
  const isTestRunner = isStudent || isCreatorTestRun;
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
            {isCreatorSandbox ? 'Creator sandbox' : 'Sandbox'} mode is using the shared activity workspace with local edits only. Creator tools can grade one question at a time or run the whole set of questions.
          </Alert>
        )}

        {isSandbox && canGradeAllQuestions && (
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <Button
              size="sm"
              variant="outline-primary"
              onClick={handleGradeAllQuestions}
              disabled={gradingAllQuestions || !!gradingQuestionQid}
            >
              {gradingAllQuestions ? <Spinner animation="border" size="sm" className="me-1" /> : null}
              {gradingAllQuestions ? 'Grading All Questions…' : 'Grade All Questions'}
            </Button>
            <span className="text-muted small">Use the per-question button to preview just one item.</span>
          </div>
        )}

        {renderBlocks(preamble, {
          editable: false,
          isActive: false,
          mode: 'run',
          isTestMode,
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
          suppressStudentTestFeedbackUi,
          hideStudentTestSections,
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
            isTestRunner &&
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
                  isTestMode,
                  prefill: existingAnswers,
                  currentGroupIndex: index,
                  codeFeedbackShown,
                  unansweredShown,
                  infoBubbleSession,
                  runtimeFeatures,
                  suppressStudentTestFeedbackUi,
                  hideStudentTestSections,
                })}

              <p ref={questionGroupAnchorRef}>
                <strong>{index + 1}.</strong> {group.intro.content}
                {Number.isFinite(Number(group?.intro?.retriesRequired)) ? (
                  <Badge bg="light" text="dark" className="border ms-2 align-middle">
                    Retries: {Math.max(0, Number(group.intro.retriesRequired))}
                  </Badge>
                ) : null}
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
                  isTestMode,
                  suppressStudentTestFeedbackUi,
                  hideStudentTestSections,
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
                  isInstructor &&
                  isSubmitted;
                const canGradeQuestionPreviewForBlock = canGradeQuestionPreview;
                const questionGradePreview = questionGradePreviews?.[qid];
                const isGradingThisQuestion = gradingQuestionQid === qid;
                const displayNumber = nonLegacyForUI ? qid : globalQuestionCounter;

                return (
                  <div key={`group-${index}-block-${bIndex}`} className="mb-2">
                    {renderedBlock}

                    {canGradeQuestionPreviewForBlock && (
                      <div className="mt-2 d-flex flex-wrap gap-2 align-items-center">
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => handleGradeSingleQuestion(qid)}
                          disabled={isGradingThisQuestion}
                        >
                          {isGradingThisQuestion ? 'Grading…' : questionGradePreview ? 'Re-grade Question' : 'Grade This Question'}
                        </Button>
                        {questionGradePreview && (
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => clearQuestionGradePreview(qid)}
                            disabled={isGradingThisQuestion}
                          >
                            Clear Preview
                          </Button>
                        )}
                      </div>
                    )}

                    {questionGradePreview?.status === 'ready' && canGradeQuestionPreviewForBlock && (
                      <Alert variant="info" className="mt-2 mb-0">
                        <div className="fw-semibold mb-1">
                          Question preview grade: {questionGradePreview.earnedTotal}/{questionGradePreview.maxTotal}
                        </div>
                        <div className="small text-muted mb-2">
                          Preview only — this does not save anything to the test attempt.
                        </div>
                        {questionGradePreview.rubricSource === 'inferred' ? (
                          <div className="small text-info mb-2">
                            No explicit score bands were found for this question, so the sandbox used a small inferred preview rubric to show a real grading result.
                          </div>
                        ) : null}
                        <div className="mb-1">
                          {questionGradePreview.maxResp > 0 && (
                            <div>
                              <strong>Written:</strong> {questionGradePreview.responseScore}/{questionGradePreview.maxResp}
                              {questionGradePreview.responseFeedback ? (
                                <div className="small mt-1">{questionGradePreview.responseFeedback}</div>
                              ) : null}
                            </div>
                          )}
                          {questionGradePreview.maxRun > 0 && (
                            <div className="mt-1">
                              <strong>Run/output:</strong> {questionGradePreview.runScore}/{questionGradePreview.maxRun}
                              {questionGradePreview.runFeedback ? (
                                <div className="small mt-1">{questionGradePreview.runFeedback}</div>
                              ) : null}
                            </div>
                          )}
                          {questionGradePreview.maxCode > 0 && (
                            <div className="mt-1">
                              <strong>Code:</strong> {questionGradePreview.codeScore}/{questionGradePreview.maxCode}
                              {questionGradePreview.codeFeedback ? (
                                <div className="small mt-1">{questionGradePreview.codeFeedback}</div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </Alert>
                    )}

                    {questionGradePreview?.status === 'error' && canGradeQuestionPreviewForBlock && (
                      <Alert variant="warning" className="mt-2 mb-0">
                        <strong>Could not grade this question preview.</strong>{' '}
                        {questionGradePreview.error || 'Please try again.'}
                      </Alert>
                    )}

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

        {canSubmitTest && isTestMode && !isSandbox && isTestRunner && timeExpired && !isSubmitted && (
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

        {canSubmitTest && isTestMode && !isSandbox && isTestRunner && !timeExpired && !isSubmitted && (
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
