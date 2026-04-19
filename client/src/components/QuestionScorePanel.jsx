// client/src/components/QuestionScorePanel.jsx
import React, { useEffect, useState } from 'react';
import { Card, Form, Button } from 'react-bootstrap';

export default function QuestionScorePanel({
  qid,
  displayNumber,
  scores,
  allowEdit,
  onSave,
}) {
  const {
    codeScore,
    runScore,
    respScore,
    codeExplain,
    runExplain,
    respExplain,
    maxCode,
    maxRun,
    maxResp,
  } = scores || {};

  // If this question truly has no scoring bands at all, don’t render anything.
  if ((maxCode || 0) === 0 && (maxRun || 0) === 0 && (maxResp || 0) === 0) {
    return null;
  }

  const makeLocalFromScores = () => ({
    codeScore: codeScore ?? '',
    runScore: runScore ?? '',
    respScore: respScore ?? '',
    codeExplain: codeExplain ?? '',
    runExplain: runExplain ?? '',
    respExplain: respExplain ?? '',
  });

  const [local, setLocal] = useState(makeLocalFromScores());
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    // If server-side scores change (regrade / reload), refresh view.
    // But don't clobber in-progress edits.
    if (!isEditing) {
      setLocal(makeLocalFromScores());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeScore, runScore, respScore, codeExplain, runExplain, respExplain]);

  const handleChange = (field) => (e) => {
    setLocal((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleStartEdit = () => {
    setLocal(makeLocalFromScores()); // ensure editor starts from latest saved state
    setIsEditing(true);
  };

  const handleCancel = () => {
    setLocal(makeLocalFromScores());
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!onSave) return;
    await onSave(qid, local);
    setIsEditing(false);
  };

  // Build the “Components:” line using only bands that actually have points
  const components = [];
  if ((maxResp || 0) > 0) {
    const earned = respScore != null ? respScore : 0;
    components.push(`Written ${earned}/${maxResp}`);
  }
  if ((maxRun || 0) > 0) {
    const earned = runScore != null ? runScore : 0;
    components.push(`Run ${earned}/${maxRun}`);
  }
  if ((maxCode || 0) > 0) {
    const earned = codeScore != null ? codeScore : 0;
    components.push(`Code ${earned}/${maxCode}`);
  }

  const totalEarned = (respScore || 0) + (runScore || 0) + (codeScore || 0);
  const totalMax = (maxResp || 0) + (maxRun || 0) + (maxCode || 0);

  const canEditNow = !!allowEdit && !!onSave;
  const showInputs = canEditNow && isEditing;

  return (
    <Card className="mt-2">
      <Card.Body>
        <Card.Title className="mb-1">
          Question {displayNumber} – Total: {totalEarned}/{totalMax}
        </Card.Title>

        {components.length > 0 && (
          <Card.Subtitle className="mb-2 text-muted">
            Components: {components.join(' · ')}
          </Card.Subtitle>
        )}

        {/* WRITTEN / RESPONSE BAND */}
        {(maxResp || 0) > 0 && (
          <div className="mb-2">
            <strong>Written feedback:</strong>
            {showInputs ? (
              <>
                <div className="d-flex align-items-center mt-1">
                  <Form.Label className="me-2 mb-0">Score</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    style={{ width: '80px' }}
                    value={local.respScore}
                    onChange={handleChange('respScore')}
                    min={0}
                    max={maxResp}
                  />
                  <span className="ms-1">/ {maxResp}</span>
                </div>
                <Form.Control
                  as="textarea"
                  rows={2}
                  className="mt-1"
                  placeholder="Short explanation (optional)"
                  value={local.respExplain}
                  onChange={handleChange('respExplain')}
                />
              </>
            ) : (
              <p className="mb-0 mt-1">
                {respExplain?.trim()
                  ? respExplain
                  : respScore === maxResp
                  ? 'Full credit for written response.'
                  : ''}
              </p>
            )}
          </div>
        )}

        {/* RUN / OUTPUT BAND */}
        {(maxRun || 0) > 0 && (
          <div className="mb-2">
            <strong>Run/output feedback:</strong>
            {showInputs ? (
              <>
                <div className="d-flex align-items-center mt-1">
                  <Form.Label className="me-2 mb-0">Score</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    style={{ width: '80px' }}
                    value={local.runScore}
                    onChange={handleChange('runScore')}
                    min={0}
                    max={maxRun}
                  />
                  <span className="ms-1">/ {maxRun}</span>
                </div>
                <Form.Control
                  as="textarea"
                  rows={2}
                  className="mt-1"
                  placeholder="Short explanation (optional)"
                  value={local.runExplain}
                  onChange={handleChange('runExplain')}
                />
              </>
            ) : (
              <p className="mb-0 mt-1">
                {runExplain?.trim()
                  ? runExplain
                  : runScore === maxRun && maxRun > 0
                  ? 'Full credit for run/output.'
                  : ''}
              </p>
            )}
          </div>
        )}

        {/* CODE BAND */}
        {(maxCode || 0) > 0 && (
          <div className="mb-2">
            <strong>Code feedback:</strong>
            {showInputs ? (
              <>
                <div className="d-flex align-items-center mt-1">
                  <Form.Label className="me-2 mb-0">Score</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    style={{ width: '80px' }}
                    value={local.codeScore}
                    onChange={handleChange('codeScore')}
                    min={0}
                    max={maxCode}
                  />
                  <span className="ms-1">/ {maxCode}</span>
                </div>
                <Form.Control
                  as="textarea"
                  rows={2}
                  className="mt-1"
                  placeholder="Short explanation (optional)"
                  value={local.codeExplain}
                  onChange={handleChange('codeExplain')}
                />
              </>
            ) : (
              <p className="mb-0 mt-1">
                {codeExplain?.trim()
                  ? codeExplain
                  : codeScore === maxCode && maxCode > 0
                  ? 'Full credit for code.'
                  : ''}
              </p>
            )}
          </div>
        )}

        {canEditNow && (
          <div className="mt-2 d-flex gap-2">
            {!isEditing ? (
              <Button size="sm" variant="outline-secondary" onClick={handleStartEdit}>
                Edit
              </Button>
            ) : (
              <>
                <Button size="sm" variant="primary" onClick={handleSave}>
                  Save scores &amp; feedback
                </Button>
                <Button size="sm" variant="secondary" onClick={handleCancel}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
