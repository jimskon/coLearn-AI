// src/pages/TestSetupPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Spinner, Alert, Card } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

export default function TestSetupPage() {
  const { courseId, activityId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const courseName = location.state?.courseName;

  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // test settings
  const [testStartAt, setTestStartAt] = useState(''); // datetime-local
  const [testDurationMinutes, setTestDurationMinutes] = useState(30);
  const [lockedBeforeStart, setLockedBeforeStart] = useState(true);
  const [lockedAfterEnd, setLockedAfterEnd] = useState(true);

  // preview of "attempts" to be created (groups of 1)
  const [attempts, setAttempts] = useState([]); // [{student_id}...]

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/courses/${courseId}/students`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const loaded = Array.isArray(data) ? data : data.students;
        const list = loaded || [];
        setStudents(list);

        // default select: students with role === 'student'
        const init = {};
        list.forEach((s) => {
          init[s.id] = s.role === 'student';
        });
        setSelected(init);
      } catch (e) {
        console.error('❌ Failed to load students:', e);
        setError('Unable to load students.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [courseId]);

  const selectedStudentList = useMemo(() => {
    return students.filter((s) => s.role === 'student' && selected[s.id]);
  }, [students, selected]);

  const toggleSelect = (id) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const prepareAttempts = () => {
    const list = selectedStudentList;
    if (list.length === 0) {
      setAttempts([]);
      return;
    }
    setAttempts(list.map((s) => ({ student_id: s.id })));
  };

  const handleSave = async () => {
    if (!testStartAt) {
      alert('Please set the test start date and time.');
      return;
    }
    if (!testDurationMinutes || testDurationMinutes <= 0) {
      alert('Please set a positive time limit in minutes.');
      return;
    }
    if (attempts.length === 0) {
      alert('Click "Prepare Test Attempts" first (and make sure at least one student is selected).');
      return;
    }

    // Convert local datetime-local string -> UTC ISO
    const testStartAtUtc = new Date(testStartAt).toISOString();

    // We reuse your existing setup-groups payload format:
    // groups = [{ members: [{student_id, role:null}] }, ...]
    const selectedStudentIds = attempts.map((a) => Number(a.student_id)).filter(Boolean);


    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/setup-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          activityId: Number(activityId),
          courseId: Number(courseId),
          selectedStudentIds,
          testStartAt: testStartAtUtc,
          testDurationMinutes: Number(testDurationMinutes),
          lockedBeforeStart: !!lockedBeforeStart,
          lockedAfterEnd: !!lockedAfterEnd,
        }),

      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(`❌ Error: ${data.error || `HTTP ${res.status}`}`);
        return;
      }

      alert('✅ Test setup saved.');
      navigate(`/view-tests/${courseId}/${activityId}`, { state: { courseName } });
    } catch (err) {
      console.error('❌ Save test setup failed:', err);
      alert('❌ Failed to save test setup.');
    }
  };

  return (
    <Container className="mt-4">
      <h2>Test Setup</h2>
      {courseName && <div className="text-muted mb-2">Course: {courseName}</div>}

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : (
        <>
          <Card className="mb-3">
            <Card.Body>
              <Row className="g-3">
                <Col md={4}>
                  <Form.Label>Test start date &amp; time</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={testStartAt}
                    onChange={(e) => setTestStartAt(e.target.value)}
                  />
                </Col>
                <Col md={3}>
                  <Form.Label>Time limit (minutes)</Form.Label>
                  <Form.Control
                    type="number"
                    min={1}
                    value={testDurationMinutes}
                    onChange={(e) => setTestDurationMinutes(Number(e.target.value) || 0)}
                  />
                </Col>
                <Col md={2} className="d-flex align-items-end">
                  <Form.Check
                    type="checkbox"
                    id="lock-before"
                    label="Lock before start"
                    checked={lockedBeforeStart}
                    onChange={(e) => setLockedBeforeStart(e.target.checked)}
                  />
                </Col>
                <Col md={3} className="d-flex align-items-end">
                  <Form.Check
                    type="checkbox"
                    id="lock-after"
                    label="Lock after end"
                    checked={lockedAfterEnd}
                    onChange={(e) => setLockedAfterEnd(e.target.checked)}
                  />
                </Col>
              </Row>
            </Card.Body>
          </Card>

          <h5>Select students allowed to take this test:</h5>
          <Row>
            {students.filter((s) => s.role === 'student').length > 0 ? (
              students
                .filter((s) => s.role === 'student')
                .map((s) => (
                  <Col md={3} key={s.id} className="mb-2">
                    <Form.Check
                      type="checkbox"
                      label={s.name}
                      checked={!!selected[s.id]}
                      onChange={() => toggleSelect(s.id)}
                    />
                  </Col>
                ))
            ) : (
              <p>No students enrolled.</p>
            )}
          </Row>

          <div className="mt-3 d-flex gap-2">
            <Button variant="secondary" onClick={prepareAttempts}>
              Prepare Test Attempts
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={attempts.length === 0}>
              Save Test Setup
            </Button>
            <Button
              variant="outline-secondary"
              onClick={() => navigate(-1)}
            >
              Back
            </Button>
          </div>

          {attempts.length > 0 && (
            <Alert variant="info" className="mt-3">
              Prepared {attempts.length} attempt{attempts.length === 1 ? '' : 's'}.
            </Alert>
          )}
        </>
      )}
    </Container>
  );
}
