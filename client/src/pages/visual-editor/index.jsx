/**
 * visual-editor/index.jsx
 *
 * VisualEditorPanel — the Visual tab content inside ActivityEditor.
 *
 * Usage:
 *   <VisualEditorPanel
 *     rawText={rawText}
 *     setRawText={setRawText}
 *     activityId={activityId}
 *   />
 *
 * The panel reads `rawText` and calls `setRawText` after every successful EER
 * operation, keeping the Source tab and the Visual tab in sync via the shared
 * state in ActivityEditor.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Alert, Badge, Button, Card, Col, Form, Modal, Row, Spinner,
} from 'react-bootstrap';
import {
  buildDocumentModel,
  extractElement,
  replaceElement,
  deleteElement,
  insertBeforeLine,
  validateGeneratedMarkup,
  validateFullDocument,
  findPendingPlaceholder,
  findPreambleRange,
  parseRawPreamble,
  parseRawQuestion,
} from '../../utils/visualEditorEngine';
import {
  generatePreamble,
  generateSection,
  generateQuestionGroupHeader,
  generateQuestion,
} from '../../utils/markupTemplates';
import { swapSourceRanges } from '../../utils/creatorVisualEdits';

// ─── Top-level panel ───────────────────────────────────────────────────────

export function VisualEditorPanel({ rawText, setRawText, activityId }) {
  const [editState, setEditState] = useState(null); // null | { type, formValues, placeholder, backup, meta }
  const [editErrors, setEditErrors] = useState([]);
  const [staleBackupWarning, setStaleBackupWarning] = useState(false);

  // Build document model from rawText on every render
  const docModel = useMemo(() => buildDocumentModel(rawText), [rawText]);

  // On mount: check for leftover placeholder from a prior interrupted edit
  useEffect(() => {
    const pending = findPendingPlaceholder(rawText);
    const backup = activityId ? localStorage.getItem(`activity-${activityId}-pre-edit`) : null;
    if (pending && backup) setStaleBackupWarning(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const restoreBackup = useCallback(() => {
    const backup = activityId ? localStorage.getItem(`activity-${activityId}-pre-edit`) : null;
    if (backup) {
      setRawText(backup);
      localStorage.removeItem(`activity-${activityId}-pre-edit`);
    }
    setStaleBackupWarning(false);
  }, [activityId, setRawText]);

  // ── Open edit modal ──────────────────────────────────────────────────────

  const openEdit = useCallback((type, elementMeta) => {
    if (editState) return; // only one at a time
    setEditErrors([]);

    const sourceLines = rawText.split('\n');
    let lineRange;
    let formValues;
    let label;

    try {
      switch (type) {
        case 'preamble':
          lineRange = findPreambleRange(sourceLines);
          formValues = parseRawPreamble(
            sourceLines.slice(lineRange.startLine - 1, lineRange.endLine)
          );
          label = 'preamble';
          break;

        case 'section':
          lineRange = { startLine: elementMeta.startLine, endLine: elementMeta.startLine };
          formValues = { title: elementMeta.rawTitle };
          label = 'section';
          break;

        case 'group':
          lineRange = { startLine: elementMeta.startLine, endLine: elementMeta.startLine };
          formValues = { title: elementMeta.rawTitle };
          label = 'group';
          break;

        case 'question':
          lineRange = { startLine: elementMeta.startLine, endLine: elementMeta.endLine };
          formValues = parseRawQuestion(
            sourceLines.slice(lineRange.startLine - 1, lineRange.endLine)
          );
          label = 'question';
          break;

        default:
          return;
      }

      const { updatedSource, placeholder, backup } = extractElement(rawText, lineRange, label);

      if (activityId) {
        localStorage.setItem(`activity-${activityId}-pre-edit`, backup);
      }

      setRawText(updatedSource);
      setEditState({ type, formValues, placeholder, backup, meta: elementMeta });
    } catch (e) {
      setEditErrors([{ type: 'error', message: String(e) }]);
    }
  }, [editState, rawText, setRawText, activityId]);

  // ── Cancel edit ─────────────────────────────────────────────────────────

  const cancelEdit = useCallback(() => {
    if (!editState) return;
    setRawText(editState.backup);
    if (activityId) localStorage.removeItem(`activity-${activityId}-pre-edit`);
    setEditState(null);
    setEditErrors([]);
  }, [editState, setRawText, activityId]);

  // ── Save edit ────────────────────────────────────────────────────────────

  const saveEdit = useCallback((newValues) => {
    if (!editState) return;
    setEditErrors([]);

    // Generate markup
    let newMarkup;
    const isNew = editState.type.startsWith('new-');
    let wrapAs = editState.type.replace('new-', '');
    try {
      switch (editState.type) {
        case 'preamble':      newMarkup = generatePreamble(newValues); break;
        case 'section':       newMarkup = generateSection(newValues); break;
        case 'group':         newMarkup = generateQuestionGroupHeader(newValues); break;
        case 'question':      newMarkup = generateQuestion(newValues); break;
        case 'new-question':  newMarkup = generateQuestion(newValues); break;
        case 'new-group':
          newMarkup = `\\questiongroup{${newValues.title || ''}}\n\\endquestiongroup`;
          break;
        default: return;
      }
    } catch (e) {
      setEditErrors([{ type: 'error', message: `Template error: ${e.message}` }]);
      return;
    }

    // Pass 1: isolated validation
    const pass1 = validateGeneratedMarkup(newMarkup, wrapAs);
    const pass1Errors = pass1.filter((i) => i.type === 'error');
    if (pass1Errors.length) {
      setEditErrors(pass1Errors);
      return;
    }

    // Replace placeholder (edit) or insert at position (new)
    let updatedSource;
    try {
      if (isNew) {
        updatedSource = insertBeforeLine(rawText, editState.meta.insertBeforeLine, newMarkup);
      } else {
        updatedSource = replaceElement(rawText, editState.placeholder, newMarkup);
      }
    } catch (e) {
      setEditErrors([{ type: 'error', message: String(e) }]);
      return;
    }

    // Pass 2: full document validation
    const pass2 = validateFullDocument(updatedSource);
    const pass2Errors = pass2.filter((i) => i.type === 'error');
    if (pass2Errors.length) {
      // Rollback
      setRawText(editState.backup);
      if (activityId) localStorage.removeItem(`activity-${activityId}-pre-edit`);
      setEditState(null);
      setEditErrors(pass2Errors.map((e) => ({ ...e, message: `[Rollback] ${e.message}` })));
      return;
    }

    // Success
    setRawText(updatedSource);
    if (activityId) localStorage.removeItem(`activity-${activityId}-pre-edit`);
    setEditState(null);
    setEditErrors([]);
  }, [editState, rawText, setRawText, activityId]);

  // ── Reorder questions ────────────────────────────────────────────────────

  const reorderQuestions = useCallback((q1, q2) => {
    if (editState) return;
    if (!q1.startLine || !q1.endLine || !q2.startLine || !q2.endLine) return;
    const swapped = swapSourceRanges(
      rawText,
      { startLine: q1.startLine, endLine: q1.endLine },
      { startLine: q2.startLine, endLine: q2.endLine }
    );
    setRawText(swapped);
  }, [editState, rawText, setRawText]);

  // ── Delete question ──────────────────────────────────────────────────────

  const deleteQuestion = useCallback((q) => {
    if (editState) return;
    if (!q.startLine || !q.endLine) return;
    if (!window.confirm(`Delete question "${q.rawPrompt.slice(0, 60)}"? This cannot be undone.`)) return;

    const updated = deleteElement(rawText, { startLine: q.startLine, endLine: q.endLine });
    const issues = validateFullDocument(updated);
    if (issues.some((i) => i.type === 'error')) {
      setEditErrors([{ type: 'error', message: 'Deletion would break the document structure. Cancelled.' }]);
      return;
    }
    setRawText(updated);
  }, [editState, rawText, setRawText]);

  // ── Delete question group ─────────────────────────────────────────────────

  const deleteGroup = useCallback((group) => {
    if (editState) return;
    if (!group.startLine || !group.endLine) return;
    if (!window.confirm(`Delete group "${(group.rawTitle || 'Untitled').slice(0, 60)}" and all its questions? This cannot be undone.`)) return;

    const updated = deleteElement(rawText, { startLine: group.startLine, endLine: group.endLine });
    const issues = validateFullDocument(updated);
    if (issues.some((i) => i.type === 'error')) {
      setEditErrors([{ type: 'error', message: 'Deletion would break the document structure. Cancelled.' }]);
      return;
    }
    setRawText(updated);
  }, [editState, rawText, setRawText]);

  // ── Open add (new element, no extract step) ───────────────────────────────

  const openAdd = useCallback((type, insertBeforeLine) => {
    if (editState) return;
    const blankValues = type === 'new-question'
      ? { prompt: '', aiMode: '', responseType: 'text', responseValues: { lines: 4 },
          feedbackPrompt: '', sampleResponses: '', followupPrompt: '', scoreBlock: null }
      : { title: '' }; // new-group
    setEditErrors([]);
    setEditState({ type, formValues: blankValues, placeholder: null,
                   backup: rawText, meta: { insertBeforeLine } });
  }, [editState, rawText]);

  // ─── Render ──────────────────────────────────────────────────────────────

  const isLocked = !!editState;

  return (
    <div style={{ padding: '1rem', opacity: 1 }}>
      {/* Stale backup warning */}
      {staleBackupWarning && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <span>An edit was interrupted and left a placeholder in the document.</span>
          <Button size="sm" variant="warning" onClick={restoreBackup}>Restore pre-edit version</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setStaleBackupWarning(false)}>Dismiss</Button>
        </Alert>
      )}

      {/* Global edit errors (rollback messages etc.) */}
      {!editState && editErrors.length > 0 && (
        <Alert variant="danger" dismissible onClose={() => setEditErrors([])}>
          {editErrors.map((e, i) => <div key={i}>{e.message}</div>)}
        </Alert>
      )}

      {/* Parse issues indicator */}
      {docModel.parseIssues?.filter((i) => i.type === 'error').length > 0 && !isLocked && (
        <Alert variant="warning" className="py-2">
          ⚠ Parser found {docModel.parseIssues.filter((i) => i.type === 'error').length} error(s) in the source.
          Fix them in the Source tab before editing visually.
        </Alert>
      )}

      {/* Edit modal */}
      {editState && (
        <EditModal
          editState={editState}
          errors={editErrors}
          onSave={saveEdit}
          onCancel={cancelEdit}
        />
      )}

      {/* Preamble card */}
      <PreambleCard
        preamble={docModel.preamble}
        locked={isLocked}
        onEdit={() => openEdit('preamble', {})}
      />

      {/* Sections */}
      {docModel.sections.map((section) => (
        <SectionCard
          key={section.key}
          section={section}
          locked={isLocked}
          onEditSection={() => openEdit('section', section)}
          onEditGroup={(g) => openEdit('group', g)}
          onEditQuestion={(q) => openEdit('question', q)}
          onReorderQ={reorderQuestions}
          onDeleteQ={deleteQuestion}
          onDeleteGroup={deleteGroup}
          onAddQ={(g) => openAdd('new-question', g.endLine)}
          onAddGroup={() => openAdd('new-group', section.endLine + 1)}
        />
      ))}

      {docModel.sections.length === 0 && !isLocked && (
        <Alert variant="info" className="mt-3">
          No sections found. Add a <code>\section{'{...}'}</code> in the Source tab first.
        </Alert>
      )}
    </div>
  );
}

// ─── Preamble Card ─────────────────────────────────────────────────────────

function PreambleCard({ preamble, locked, onEdit }) {
  return (
    <Card className="mb-3" style={{ opacity: locked ? 0.5 : 1 }}>
      <Card.Header className="d-flex justify-content-between align-items-center bg-light">
        <strong>📄 Preamble / Document Metadata</strong>
        <Button size="sm" variant="outline-primary" disabled={locked} onClick={onEdit}>
          Edit
        </Button>
      </Card.Header>
      <Card.Body className="py-2 small text-muted" style={{ columnCount: 2 }}>
        <div><strong>Title:</strong> {preamble.title || <em>—</em>}</div>
        <div><strong>Name:</strong> {preamble.name || <em>—</em>}</div>
        <div><strong>Mode:</strong> {preamble.mode || 'group'}</div>
        <div><strong>Retries:</strong> {preamble.retries || <em>default</em>}</div>
        <div><strong>Language:</strong> {preamble.language || <em>English</em>}</div>
        <div><strong>AI mode:</strong> {preamble.aiMode || 'no-positive'}</div>
        {preamble.studentLevel && <div><strong>Level:</strong> {preamble.studentLevel}</div>}
      </Card.Body>
    </Card>
  );
}

// ─── Section Card ──────────────────────────────────────────────────────────

function SectionCard({ section, locked, onEditSection, onEditGroup, onEditQuestion, onReorderQ, onDeleteQ, onDeleteGroup, onAddQ, onAddGroup }) {
  return (
    <Card className="mb-3" style={{ opacity: locked ? 0.5 : 1, borderLeft: '4px solid #0d6efd' }}>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span>
          <Badge bg="primary" className="me-2">§</Badge>
          <strong>{section.rawTitle || <em className="text-muted">Untitled Section</em>}</strong>
          {section.isImplicit && <span className="text-muted ms-2 small">(implicit)</span>}
        </span>
        {!section.isImplicit && (
          <Button size="sm" variant="outline-secondary" disabled={locked} onClick={onEditSection}>
            Rename
          </Button>
        )}
      </Card.Header>
      <Card.Body className="p-2">
        {section.groups.length === 0 && (
          <p className="text-muted small ms-2 mb-0">No question groups in this section.</p>
        )}
        {section.groups.map((group) => (
          <GroupCard
            key={`g-${group.groupId}`}
            group={group}
            locked={locked}
            onEditGroup={() => onEditGroup(group)}
            onEditQuestion={onEditQuestion}
            onReorderQ={onReorderQ}
            onDeleteQ={onDeleteQ}
            onDeleteGroup={() => onDeleteGroup(group)}
            onAddQ={() => onAddQ(group)}
          />
        ))}
        <div className="d-flex justify-content-end mt-2">
          <Button size="sm" variant="outline-primary" disabled={locked} onClick={onAddGroup}>
            ＋ Add Question Group
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}

// ─── Group Card ────────────────────────────────────────────────────────────

function GroupCard({ group, locked, onEditGroup, onEditQuestion, onReorderQ, onDeleteQ, onDeleteGroup, onAddQ }) {
  return (
    <Card className="mb-2" style={{ borderLeft: '4px solid #6c757d' }}>
      <Card.Header className="d-flex justify-content-between align-items-center py-1 bg-light">
        <span>
          <Badge bg="secondary" className="me-2">Q-Group</Badge>
          <strong>{group.rawTitle || <em className="text-muted">Untitled Group</em>}</strong>
        </span>
        <div className="d-flex gap-1">
          <Button size="sm" variant="outline-secondary" disabled={locked} onClick={onEditGroup}>Rename</Button>
          <Button size="sm" variant="outline-danger" disabled={locked} onClick={onDeleteGroup} title="Delete this group and all its questions">✕ Del</Button>
        </div>
      </Card.Header>
      <Card.Body className="p-2">
        {group.questions.length === 0 && (
          <p className="text-muted small ms-2 mb-0">No questions in this group.</p>
        )}
        {group.questions.map((q, qi) => (
          <QuestionRow
            key={q.id || qi}
            q={q}
            qi={qi}
            totalInGroup={group.questions.length}
            locked={locked}
            onEdit={() => onEditQuestion(q)}
            onMoveUp={qi > 0 ? () => onReorderQ(group.questions[qi - 1], q) : null}
            onMoveDown={qi < group.questions.length - 1 ? () => onReorderQ(q, group.questions[qi + 1]) : null}
            onDelete={() => onDeleteQ(q)}
          />
        ))}
        <div className="d-flex justify-content-end mt-2">
          <Button size="sm" variant="outline-success" disabled={locked} onClick={onAddQ}>
            ＋ Add Question
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}

// ─── Question Row ──────────────────────────────────────────────────────────

function QuestionRow({ q, qi, locked, onEdit, onMoveUp, onMoveDown, onDelete }) {
  const prompt = q.rawPrompt || '';
  const displayPrompt = prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt;
  return (
    <div className="d-flex align-items-start gap-2 py-1 border-bottom" style={{ fontSize: '0.875rem' }}>
      <span className="text-muted" style={{ minWidth: '1.6rem' }}>Q{qi + 1}.</span>
      <span style={{ flex: 1 }}>
        <span title={prompt}>{displayPrompt || <em className="text-muted">No prompt</em>}</span>
        <Badge bg="light" text="dark" className="ms-2 small">{q.responseSummary}</Badge>
        {q.feedbackPrompt && <Badge bg="info" text="dark" className="ms-1 small">AI</Badge>}
      </span>
      <div className="d-flex gap-1">
        <Button size="sm" variant="outline-secondary" disabled={locked || !onMoveUp} onClick={onMoveUp} title="Move up">↑</Button>
        <Button size="sm" variant="outline-secondary" disabled={locked || !onMoveDown} onClick={onMoveDown} title="Move down">↓</Button>
        <Button size="sm" variant="outline-primary" disabled={locked} onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="outline-danger" disabled={locked} onClick={onDelete}>✕</Button>
      </div>
    </div>
  );
}

// ─── Edit Modal ────────────────────────────────────────────────────────────

function EditModal({ editState, errors, onSave, onCancel }) {
  const [values, setValues] = useState(editState.formValues);

  const set = (key, val) => setValues((prev) => ({ ...prev, [key]: val }));

  const handleSave = () => onSave(values);

  const titles = {
    preamble: 'Edit Preamble / Document Metadata',
    section: 'Rename Section',
    group: 'Rename Question Group',
    question: 'Edit Question',
    'new-question': 'Add New Question',
    'new-group': 'Add New Question Group',
  };

  return (
    <Modal show size="lg" onHide={onCancel} backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>{titles[editState.type] || 'Edit'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {errors.length > 0 && (
          <Alert variant="danger" className="mb-3">
            {errors.map((e, i) => <div key={i}>{e.message || JSON.stringify(e)}</div>)}
          </Alert>
        )}

        {editState.type === 'preamble' && (
          <PreambleForm values={values} set={set} />
        )}
        {(editState.type === 'section' || editState.type === 'group' || editState.type === 'new-group') && (
          <TitleForm values={values} set={set} label={editState.type === 'section' ? 'Section title' : 'Group title'} />
        )}
        {(editState.type === 'question' || editState.type === 'new-question') && (
          <QuestionForm values={values} set={set} />
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={handleSave}>Save</Button>
      </Modal.Footer>
    </Modal>
  );
}

// ─── Preamble Form ─────────────────────────────────────────────────────────

function PreambleForm({ values, set }) {
  return (
    <Row className="g-3">
      <Col md={6}>
        <Form.Group>
          <Form.Label>Title</Form.Label>
          <Form.Control value={values.title || ''} onChange={(e) => set('title', e.target.value)} />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>Internal Name <span className="text-muted small">(unique ID)</span></Form.Label>
          <Form.Control value={values.name || ''} onChange={(e) => set('name', e.target.value)} />
        </Form.Group>
      </Col>
      <Col md={4}>
        <Form.Group>
          <Form.Label>Mode</Form.Label>
          <Form.Select value={values.mode || 'group'} onChange={(e) => set('mode', e.target.value)}>
            <option value="group">group (collaborative)</option>
            <option value="test">test (graded)</option>
            <option value="demo">demo</option>
            <option value="assignment">assignment</option>
          </Form.Select>
        </Form.Group>
      </Col>
      <Col md={4}>
        <Form.Group>
          <Form.Label>AI Mode</Form.Label>
          <Form.Select value={values.aiMode || 'no-positive'} onChange={(e) => set('aiMode', e.target.value)}>
            <option value="no-positive">no-positive (default)</option>
            <option value="positive">positive</option>
            <option value="positive, brief">positive + brief</option>
            <option value="lenient">lenient</option>
          </Form.Select>
        </Form.Group>
      </Col>
      <Col md={4}>
        <Form.Group>
          <Form.Label>Max Retries</Form.Label>
          <Form.Control
            type="number" min="1" max="20"
            value={values.retries || ''}
            placeholder="(default)"
            onChange={(e) => set('retries', e.target.value)}
          />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>Student Level</Form.Label>
          <Form.Control value={values.studentLevel || ''} placeholder="e.g. Second Year"
            onChange={(e) => set('studentLevel', e.target.value)} />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>Language <span className="text-muted small">(for AI feedback)</span></Form.Label>
          <Form.Control value={values.language || ''} placeholder="English"
            onChange={(e) => set('language', e.target.value)} />
        </Form.Group>
      </Col>
      <Col md={12}>
        <Form.Group>
          <Form.Label>Activity Context <span className="text-muted small">(introductory paragraph)</span></Form.Label>
          <Form.Control as="textarea" rows={3} value={values.activityContext || ''}
            onChange={(e) => set('activityContext', e.target.value)} />
        </Form.Group>
      </Col>
      <Col md={12}>
        <Form.Group>
          <Form.Label>AI Code Guidance <span className="text-muted small">(global AI behavior rules)</span></Form.Label>
          <Form.Control as="textarea" rows={3} value={values.aiCodeGuidance || ''}
            onChange={(e) => set('aiCodeGuidance', e.target.value)} />
        </Form.Group>
      </Col>
    </Row>
  );
}

// ─── Title Form (section / group rename) ───────────────────────────────────

function TitleForm({ values, set, label }) {
  return (
    <Form.Group>
      <Form.Label>{label}</Form.Label>
      <Form.Control
        autoFocus
        value={values.title || ''}
        onChange={(e) => set('title', e.target.value)}
      />
    </Form.Group>
  );
}

// ─── Question Form ─────────────────────────────────────────────────────────

function QuestionForm({ values, set }) {
  const setRV = (key, val) =>
    set('responseValues', { ...(values.responseValues || {}), [key]: val });

  const setChoice = (idx, val) => {
    const choices = [...((values.responseValues || {}).choices || [])];
    choices[idx] = val;
    setRV('choices', choices);
  };
  const addChoice = () => setRV('choices', [...((values.responseValues || {}).choices || []), '']);
  const removeChoice = (idx) => {
    const choices = [...((values.responseValues || {}).choices || [])];
    choices.splice(idx, 1);
    setRV('choices', choices);
  };

  const rv = values.responseValues || {};

  return (
    <div>
      {/* Prompt */}
      <Form.Group className="mb-3">
        <Form.Label><strong>Question Prompt</strong></Form.Label>
        <Form.Control
          as="textarea" rows={3} autoFocus
          value={values.prompt || ''}
          onChange={(e) => set('prompt', e.target.value)}
        />
      </Form.Group>

      {/* AI mode override */}
      <Row className="mb-3">
        <Col md={6}>
          <Form.Group>
            <Form.Label>AI Mode Override <span className="text-muted small">(optional, question-level)</span></Form.Label>
            <Form.Select value={values.aiMode || ''} onChange={(e) => set('aiMode', e.target.value)}>
              <option value="">(use activity default)</option>
              <option value="no-positive">no-positive</option>
              <option value="positive">positive</option>
              <option value="positive, brief">positive + brief</option>
              <option value="lenient">lenient</option>
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group>
            <Form.Label><strong>Response Type</strong></Form.Label>
            <Form.Select value={values.responseType || 'none'} onChange={(e) => {
              set('responseType', e.target.value);
              set('responseValues', {});
            }}>
              <option value="none">Informational (no response)</option>
              <option value="text">Text Response</option>
              <option value="python">Python Code</option>
              <option value="cpp">C++ Code</option>
              <option value="mc_graded">Multiple Choice (graded)</option>
              <option value="mc_survey">Multiple Choice (survey / multi-select)</option>
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>

      {/* Response-type fields */}
      {values.responseType === 'text' && (
        <Form.Group className="mb-3">
          <Form.Label>Response box height (lines)</Form.Label>
          <Form.Control type="number" min={1} max={30} style={{ width: '6rem' }}
            value={rv.lines ?? 4}
            onChange={(e) => setRV('lines', e.target.value)} />
        </Form.Group>
      )}

      {(values.responseType === 'python' || values.responseType === 'cpp') && (
        <div className="mb-3">
          <Form.Group className="mb-2">
            <Form.Label>Starter code</Form.Label>
            <Form.Control as="textarea" rows={6} className="font-monospace"
              value={rv.code || ''}
              onChange={(e) => setRV('code', e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Label>Timeout (ms) <span className="text-muted small">(optional)</span></Form.Label>
            <Form.Control type="number" min={1000} step={1000} style={{ width: '10rem' }}
              value={rv.timeout || ''}
              placeholder="(none)"
              onChange={(e) => setRV('timeout', e.target.value || null)} />
          </Form.Group>
        </div>
      )}

      {values.responseType === 'mc_graded' && (
        <div className="mb-3">
          <Form.Group className="mb-2">
            <Form.Label>Correct answer</Form.Label>
            <Form.Control value={rv.correctAnswer || ''}
              onChange={(e) => setRV('correctAnswer', e.target.value)} />
          </Form.Group>
          <Form.Label>Choices</Form.Label>
          {(rv.choices || []).map((c, idx) => (
            <div key={idx} className="d-flex gap-2 mb-1">
              <Form.Control value={c} onChange={(e) => setChoice(idx, e.target.value)} />
              <Button size="sm" variant="outline-danger" onClick={() => removeChoice(idx)}>✕</Button>
            </div>
          ))}
          <Button size="sm" variant="outline-secondary" onClick={addChoice} className="mt-1">+ Add Choice</Button>
        </div>
      )}

      {values.responseType === 'mc_survey' && (
        <div className="mb-3">
          <Form.Label>Choices (multi-select, no correct answer)</Form.Label>
          {(rv.choices || []).map((c, idx) => (
            <div key={idx} className="d-flex gap-2 mb-1">
              <Form.Control value={c} onChange={(e) => setChoice(idx, e.target.value)} />
              <Button size="sm" variant="outline-danger" onClick={() => removeChoice(idx)}>✕</Button>
            </div>
          ))}
          <Button size="sm" variant="outline-secondary" onClick={addChoice} className="mt-1">+ Add Choice</Button>
        </div>
      )}

      <hr />

      {/* Feedback / sample */}
      <Form.Group className="mb-3">
        <Form.Label>Feedback Prompt <span className="text-muted small">(AI grading guidance — not shown to students)</span></Form.Label>
        <Form.Control as="textarea" rows={2}
          value={values.feedbackPrompt || ''}
          onChange={(e) => set('feedbackPrompt', e.target.value)} />
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Label>Sample Responses <span className="text-muted small">(instructor solution — hidden)</span></Form.Label>
        <Form.Control as="textarea" rows={2}
          value={values.sampleResponses || ''}
          onChange={(e) => set('sampleResponses', e.target.value)} />
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Label>Follow-up Prompt <span className="text-muted small">(optional AI follow-up hint)</span></Form.Label>
        <Form.Control as="textarea" rows={2}
          value={values.followupPrompt || ''}
          onChange={(e) => set('followupPrompt', e.target.value)} />
      </Form.Group>

      {/* Score block (optional) */}
      <ScoreBlockFields
        scoreBlock={values.scoreBlock}
        setScoreBlock={(sb) => set('scoreBlock', sb)}
      />
    </div>
  );
}

// ─── Score Block Sub-Form ──────────────────────────────────────────────────

function ScoreBlockFields({ scoreBlock, setScoreBlock }) {
  const [enabled, setEnabled] = useState(!!scoreBlock);

  const toggle = (checked) => {
    setEnabled(checked);
    setScoreBlock(checked ? { points: 10, type: 'response', rubric: '' } : null);
  };

  const set = (key, val) => setScoreBlock({ ...(scoreBlock || {}), [key]: val });

  return (
    <div>
      <Form.Check
        type="switch"
        label="Include scoring block (test mode)"
        checked={enabled}
        onChange={(e) => toggle(e.target.checked)}
        className="mb-2"
      />
      {enabled && scoreBlock && (
        <Row className="g-2">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Points</Form.Label>
              <Form.Control type="number" min={1} value={scoreBlock.points || 10}
                onChange={(e) => set('points', parseInt(e.target.value, 10) || 1)} />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Type</Form.Label>
              <Form.Select value={scoreBlock.type || 'response'} onChange={(e) => set('type', e.target.value)}>
                <option value="response">response</option>
                <option value="code">code</option>
                <option value="output">output</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group>
              <Form.Label>Rubric</Form.Label>
              <Form.Control as="textarea" rows={3} value={scoreBlock.rubric || ''}
                onChange={(e) => set('rubric', e.target.value)} />
            </Form.Group>
          </Col>
        </Row>
      )}
    </div>
  );
}

export default VisualEditorPanel;
