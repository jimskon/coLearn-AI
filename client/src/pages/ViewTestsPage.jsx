import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { formatUtcToLocal, utcToLocalInputValue } from '../utils/time';
import { Container, Table, Spinner, Alert, Button, Badge, Modal, Form } from 'react-bootstrap';


export default function ViewTestsPage() {
  const { courseId, activityId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const incomingCourseName = location.state && location.state.courseName;

  const [activityTitle, setActivityTitle] = useState('');
  const [courseName, setCourseName] = useState(incomingCourseName || '');
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [clearing, setClearing] = useState(new Set());
  const [reviewing, setReviewing] = useState(new Set());

  const [editing, setEditing] = useState(null); // { instanceId, startAtLocal, durationMinutes }
  const [savingEdit, setSavingEdit] = useState(false);



  const toLocalInputValue = (utcString) => {
    if (!utcString) return '';
    const d = new Date(utcString);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const fetchTests = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`
      );
      const data = await res.json();
      console.log('RAW group[0]:', data.groups?.[0]);
console.log('submitted_at raw:', data.groups?.[0]?.submitted_at);
console.log('test_start_at raw:', data.groups?.[0]?.test_start_at);

      if (!Array.isArray(data.groups)) throw new Error('Bad response format');

      setCourseName(data.courseName || incomingCourseName || '');
      setActivityTitle(data.activityTitle || '');
      setTests(data.groups);
    } catch (err) {
      console.error('❌ Error loading tests:', err);
      setError('Could not load tests.');
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (t) => {
    setEditing({
      instanceId: t.instance_id,
      startAtLocal: t.test_start_at ? utcToLocalInputValue(t.test_start_at) : '',
      durationMinutes: t.test_duration_minutes ?? 30,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;

    // Basic validation
    const minutes = Number(editing.durationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      alert('Duration must be a positive number of minutes.');
      return;
    }
    if (!editing.startAtLocal) {
      alert('Please choose a start date/time.');
      return;
    }

    setSavingEdit(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${editing.instanceId}/test-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          testStartAt: new Date(editing.startAtLocal).toISOString(),
          testDurationMinutes: Number(editing.durationMinutes),
        }),

      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to update test settings');

      setEditing(null);
      await fetchTests();
    } catch (err) {
      console.error('❌ Save test settings failed:', err);
      alert(err.message || 'Failed to save test settings.');
    } finally {
      setSavingEdit(false);
    }
  };


  useEffect(() => {
    if (!courseId || !activityId) return;
    fetchTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, activityId]);

  const clearAnswers = async (instanceId) => {
    if (!window.confirm('Clear all saved answers for this test? This cannot be undone.')) return;

    const next = new Set(clearing);
    next.add(instanceId);
    setClearing(next);

    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/responses`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');

      await fetchTests();
    } catch (e) {
      console.error('❌ Clear answers failed', e);
      alert('Failed to clear answers.');
    } finally {
      const n2 = new Set(clearing);
      n2.delete(instanceId);
      setClearing(n2);
    }
  };

  const handleReopen = async (instanceId) => {
    const minutesStr = window.prompt('Reopen test for how many minutes?', '30');
    if (!minutesStr) return;

    const minutes = Number(minutesStr);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      alert('Please enter a positive number of minutes.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to reopen test');

      await fetchTests();
    } catch (err) {
      console.error('❌ Reopen failed:', err);
      alert(err.message || 'Failed to reopen test.');
    }
  };

  const handleMarkReviewed = async (instanceId) => {
    const next = new Set(reviewing);
    next.add(instanceId);
    setReviewing(next);

    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/mark-reviewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to mark reviewed');

      await fetchTests();
    } catch (err) {
      console.error('❌ Mark reviewed failed:', err);
      alert(err.message || 'Failed to mark reviewed.');
    } finally {
      const n2 = new Set(reviewing);
      n2.delete(instanceId);
      setReviewing(n2);
    }
  };

  return (
    <Container className="mt-4">
      <h2>
        {activityTitle ? `Tests: ${activityTitle}` : 'Tests'}
        <Badge bg="warning" text="dark" className="ms-2">
          Test
        </Badge>
      </h2>
      {courseName && <h4 className="text-muted">{courseName}</h4>}

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : tests.length === 0 ? (
        <Alert variant="info">No test attempts found.</Alert>
      ) : (
        <Table striped bordered hover responsive className="mt-3">
          <thead>
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Start</th>
              <th>Duration</th>
              <th>Reopen until</th>
              <th>Submitted</th>
              <th>Score</th>
              <th style={{ width: 360 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => {
              const instanceId = t.instance_id;

              const member = (t.members && t.members[0]) || {};
              const studentLabel = member.email
                ? `${member.name} <${member.email}>`
                : (member.name || '(unknown)');

              const hasTiming = !!t.test_start_at && Number(t.test_duration_minutes) > 0;
              const isSubmitted = !!t.submitted_at;
              const isGraded = !!t.graded_at;
              const isReviewed = !!t.review_complete;

              const earned = t.points_earned != null ? Number(t.points_earned) : null;
              const possible = t.points_possible != null ? Number(t.points_possible) : null;
              const hasScore = Number.isFinite(earned) && Number.isFinite(possible);

              let statusText = 'Not started';
              if (hasTiming) statusText = 'In progress';
              if (isSubmitted) statusText = 'Submitted';
              if (isGraded) statusText = 'Graded';
              if (isReviewed) statusText = 'Reviewed';

              return (
                <tr key={instanceId}>
                  <td>{studentLabel}</td>

                  <td>
                    {statusText}{' '}
                    {isReviewed ? (
                      <Badge bg="primary" className="ms-1">Reviewed</Badge>
                    ) : isGraded ? (
                      <Badge bg="info" className="ms-1">Graded</Badge>
                    ) : isSubmitted ? (
                      <Badge bg="success" className="ms-1">Submitted</Badge>
                    ) : hasTiming ? (
                      <Badge bg="secondary" className="ms-1">In progress</Badge>
                    ) : null}
                  </td>

                  <td>{t.test_start_at ? formatUtcToLocal(t.test_start_at) : '—'}</td>
                  <td>{hasTiming ? `${t.test_duration_minutes} min` : '—'}</td>
                  <td>{t.test_reopen_until ? formatUtcToLocal(t.test_reopen_until) : '—'}</td>
                  <td>{t.submitted_at ? formatUtcToLocal(t.submitted_at) : 'Not submitted'}</td>
                  <td>{hasScore ? `${earned}/${possible}` : '—'}</td>

                  <td>
                    <div className="d-flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(`/run/${instanceId}`, { state: { courseName } })}
                      >
                        View
                      </Button>

                      {hasTiming && !isSubmitted && (
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => handleReopen(instanceId)}
                        >
                          Reopen
                        </Button>

                      )}
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => openEdit(t)}
                      >
                        Edit
                      </Button>

                      <Button
                        variant="outline-danger"
                        size="sm"
                        disabled={clearing.has(instanceId)}
                        onClick={() => clearAnswers(instanceId)}
                      >
                        {clearing.has(instanceId) ? 'Clearing…' : 'Clear'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Modal show={!!editing} onHide={() => setEditing(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Edit test timing</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Start date & time</Form.Label>
            <Form.Control
              type="datetime-local"
              value={editing?.startAtLocal || ''}
              onChange={(e) => setEditing((prev) => ({ ...prev, startAtLocal: e.target.value }))}
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Duration (minutes)</Form.Label>
            <Form.Control
              type="number"
              min={1}
              value={editing?.durationMinutes ?? 30}
              onChange={(e) => setEditing((prev) => ({ ...prev, durationMinutes: e.target.value }))}
            />
          </Form.Group>

          <div className="text-muted small">
            Note: changing the start/duration affects lockout timing for this instance.
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={() => setEditing(null)} disabled={savingEdit}>
            Cancel
          </Button>
          <Button variant="primary" onClick={saveEdit} disabled={savingEdit}>
            {savingEdit ? 'Saving…' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>

    </Container>
  );
}
