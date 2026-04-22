// client/src/pages/ViewGroupsPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Container,
  Card,
  Spinner,
  Alert,
  Button,
  Row,
  Col,
  Form,
} from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { FaUserCheck, FaLaptop } from 'react-icons/fa';

function progressLabelFromInstanceRow(g) {
  const tg = Number(g.total_groups || 0);
  const cg = Number(g.completed_groups || 0);
  const status = String(g.progress_status || '').toLowerCase();

  if (status === 'completed') return 'Activity complete';
  if (status === 'not_started') return 'Not started';

  if (tg > 0) return `Question Group ${Math.min(cg + 1, tg)} of ${tg}`;
  return 'In progress';
}

function isCompleteFromInstanceRow(g) {
  const tg = Number(g.total_groups ?? 0);
  const cg = Number(g.completed_groups ?? 0);

  // If counters exist, they decide completion
  if (tg > 0) return cg >= tg;

  // Else, DB status decides
  return String(g.progress_status || '').toLowerCase() === 'completed';
}

export default function ViewGroupsPage() {
  const { courseId, activityId } = useParams();
  const location = useLocation();
  const incomingCourseName = location.state && location.state.courseName;
  const navigate = useNavigate();

  const [activityTitle, setActivityTitle] = useState('');
  const [courseName, setCourseName] = useState(incomingCourseName || '');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(new Set());

  // Live-edit state
  const [available, setAvailable] = useState([]);
  const [active, setActive] = useState([]);
  const [selectedAdd, setSelectedAdd] = useState('');
  const [selectedRemove, setSelectedRemove] = useState('');

  const fetchGroups = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`,
        { credentials: 'include' }
      );
      const data = await res.json();

      console.log('[VIEWGROUPS] raw data:', data);
      console.log('[VIEWGROUPS] first row keys:', data?.groups?.[0] && Object.keys(data.groups[0]));

      if (!res.ok) throw new Error(data?.error || 'Request failed');
      if (!Array.isArray(data.groups)) throw new Error('Bad response format: expected { groups: [] }');

      setCourseName(data.courseName || incomingCourseName || '');
      setActivityTitle(data.activityTitle || '');
      setGroups(data.groups);
    } catch (err) {
      console.error('❌ Error loading groups:', err);
      setError(err?.message || 'Could not load groups.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!courseId || !activityId) return;
    fetchGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, activityId]);

  const refreshStudents = async () => {
    try {
      const [a, b] = await Promise.all([
        fetch(`${API_BASE_URL}/api/groups/${activityId}/${courseId}/available-students`, {
          credentials: 'include',
        }).then((r) => r.json()),
        fetch(`${API_BASE_URL}/api/groups/${activityId}/${courseId}/active-students`, {
          credentials: 'include',
        }).then((r) => r.json()),
      ]);
      setAvailable(a.students || []);
      setActive(b.students || []);
    } catch (err) {
      console.error('❌ Error fetching students:', err);
    }
  };

  useEffect(() => {
    if (courseId && activityId) refreshStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, activityId]);

  const clearGroupAnswers = async (instanceId) => {
    if (!window.confirm('Clear all saved answers for this group? This cannot be undone.')) return;

    const next = new Set(clearing);
    next.add(instanceId);
    setClearing(next);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/responses`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        }
      );

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Failed to clear');

      await fetchGroups();
    } catch (e) {
      console.error('❌ Clear answers failed', e);
      alert(e?.message || 'Failed to clear answers.');
    } finally {
      const n2 = new Set(clearing);
      n2.delete(instanceId);
      setClearing(n2);
    }
  };

  const handleAddToGroup = async () => {
    if (!selectedAdd) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/groups/${activityId}/${courseId}/smart-add`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ studentId: Number(selectedAdd) }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to add student');

      setSelectedAdd('');
      await refreshStudents();
      await fetchGroups();
    } catch (err) {
      console.error('❌ Error adding student:', err);
      alert(err?.message || 'Failed to add student');
    }
  };

  const handleAddAsSoloGroup = async () => {
    if (!selectedAdd) return;

    if (!window.confirm('Create a new group with this student only (group of one)?')) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/groups/${activityId}/${courseId}/add-solo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ studentId: Number(selectedAdd) }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to create solo group');

      setSelectedAdd('');
      await refreshStudents();
      await fetchGroups();
    } catch (err) {
      console.error('❌ Error creating solo group:', err);
      alert(err?.message || 'Failed to create group of one');
    }
  };

  const handleRemove = async () => {
    if (!selectedRemove) return;

    const [activityInstanceIdStr, studentIdStr] = selectedRemove.split(':');
    const activityInstanceId = Number(activityInstanceIdStr);
    const studentId = Number(studentIdStr);

    if (!activityInstanceId || !studentId) return;
    if (!window.confirm('Remove this student from the activity?')) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/groups/${activityInstanceId}/remove/${studentId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to remove student');

      setSelectedRemove('');
      await refreshStudents();
      await fetchGroups();
    } catch (err) {
      console.error('❌ Error removing student:', err);
      alert(err?.message || 'Failed to remove student');
    }
  };

  return (
    <Container className="mt-4">
      <h2>{activityTitle ? `Activity: ${activityTitle}` : 'Groups for Activity'}</h2>
      {courseName && <h4 className="text-muted">{courseName}</h4>}

      {/* Add / Remove UI */}
      <div className="my-4 d-flex gap-3 align-items-center flex-wrap">
        <Form.Select
          value={selectedAdd}
          onChange={(e) => setSelectedAdd(e.target.value)}
          style={{ maxWidth: 320 }}
        >
          <option value="">Add student...</option>
          {available.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.email})
            </option>
          ))}
        </Form.Select>

        <div className="d-flex gap-2">
          <Button variant="primary" onClick={handleAddToGroup} disabled={!selectedAdd}>
            Add to group
          </Button>
          <Button variant="outline-secondary" onClick={handleAddAsSoloGroup} disabled={!selectedAdd}>
            Group of one
          </Button>
        </div>

        <Form.Select
          value={selectedRemove}
          onChange={(e) => setSelectedRemove(e.target.value)}
          style={{ maxWidth: 380 }}
        >
          <option value="">Remove student...</option>
          {active.map((s) => (
            <option
              key={`${s.activity_instance_id}:${s.id}`}
              value={`${s.activity_instance_id}:${s.id}`}
            >
              G{s.group_number} — {s.name}
              {s.role ? ` (${s.role})` : ''}
            </option>
          ))}
        </Form.Select>

        <Button variant="danger" onClick={handleRemove} disabled={!selectedRemove}>
          Remove
        </Button>
      </div>

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : groups.length === 0 ? (
        <Alert variant="info">No groups available.</Alert>
      ) : (
        <Row>
          {groups.map((group) => {
            const isComplete = isCompleteFromInstanceRow(group);

            return (
              <Col lg={4} md={6} sm={12} key={group.instance_id}>
                <Card className="mb-3">
                  <Card.Header className="d-flex justify-content-between align-items-center flex-wrap">
                    <div>
                      Group {group.group_number} —{' '}
                      <strong className="ms-2">{progressLabelFromInstanceRow(group)}</strong>
                    </div>

                    <div className="d-flex gap-2 mt-2 mt-sm-0 flex-wrap">
                      <Button
                        variant="outline-danger"
                        size="sm"
                        disabled={clearing.has(group.instance_id)}
                        onClick={() => clearGroupAnswers(group.instance_id)}
                      >
                        {clearing.has(group.instance_id) ? 'Clearing…' : 'Clear Answers'}
                      </Button>

                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(`/run/${group.instance_id}`, { state: { courseName } })}
                      >
                        {isComplete ? 'Review Activity' : 'View Activity'}
                      </Button>
                    </div>
                  </Card.Header>

                  <Card.Body>
                    <ul>
                      {(group.members || []).map((m, i) => (
                        <li key={i}>
                          {m.name}{' '}
                          <span className="text-muted">&lt;{m.email}&gt;</span>
                          {group.active_student_id === m.student_id && (
                            <FaUserCheck title="Active student" className="text-success ms-1" />
                          )}
                          {m.connected && <FaLaptop title="Connected" className="text-info ms-1" />}
                          {m.role && <span className="ms-2 text-muted">({m.role})</span>}
                        </li>
                      ))}
                    </ul>
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </Container>
  );
}
