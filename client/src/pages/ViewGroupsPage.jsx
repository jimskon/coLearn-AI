// client/src/pages/ViewGroupsPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Container,
  Card,
  Spinner,
  Alert,
  Button,
  ButtonGroup,
  Badge,
  Row,
  Col,
  Form,
} from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';
import { FaUserCheck, FaLaptop, FaRandom } from 'react-icons/fa';
import { formatUtcToLocal, parseUtcDbDatetime } from '../utils/time';

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

function getConnectedMembers(group) {
  return (group.members || []).filter((member) => member.connected);
}

function getActiveMember(group) {
  const activeId = group.active_student_id == null ? null : String(group.active_student_id);
  if (!activeId) return null;
  return (group.members || []).find((member) => String(member.student_id) === activeId) || null;
}

function groupProgressItems(group) {
  const completed = Math.max(Number(group.completed_groups || 0), 0);
  const totalGroups = Math.max(Number(group.total_groups || 0), 0);
  const counts = group.group_submit_counts || {};
  const isActivityComplete = String(group.progress_status || '').toLowerCase() === 'completed';

  const countKeys = Object.keys(counts)
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value) && value > 0);

  const inferredTotal = isActivityComplete ? completed : completed + 1;
  const total = Math.max(totalGroups, inferredTotal, ...countKeys, 0);
  if (total <= 0) return [];

  const activeGroup = isActivityComplete ? 0 : Math.min(completed + 1, total);

  return Array.from({ length: total }, (_, index) => {
    const questionGroup = index + 1;
    const count = Number(counts[String(questionGroup)] || 0);
    const isDone = questionGroup <= completed;
    const isActive = activeGroup > 0 && questionGroup === activeGroup;

    return {
      questionGroup,
      count,
      isDone,
      isActive,
    };
  });
}

function GroupProgressBars({ group }) {
  const items = groupProgressItems(group);
  if (!items.length) return null;

  const maxCount = Math.max(1, ...items.map((item) => item.count));
  const columns = Math.min(items.length, 9);

  return (
    <div className="border-top pt-3 mt-3">
      <div
        className="d-grid align-items-end"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          columnGap: 8,
          rowGap: 12,
        }}
        aria-label="Question group submission counts"
      >
        {items.map((item) => {
          const height = Math.max(20, Math.round((item.count / maxCount) * 48));
          const background = item.isActive ? '#198754' : item.isDone ? '#0d6efd' : '#ced4da';
          const textColor = item.isDone || item.isActive ? '#fff' : '#212529';

          return (
            <div
              key={item.questionGroup}
              className="d-flex flex-column align-items-center justify-content-end"
              style={{ minWidth: 0 }}
              title={`Question Group ${item.questionGroup}: ${item.count} submissions`}
            >
              <div className="small text-muted mb-1 text-nowrap">Q{item.questionGroup}</div>
              <div
                className="d-flex align-items-center justify-content-center rounded"
                style={{
                  width: '100%',
                  maxWidth: 28,
                  height,
                  background,
                  color: textColor,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                <span
                  style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                  }}
                >
                  {item.count}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTimerMinutesLabel(remainingMs) {
  if (remainingMs <= 0) return 'Time out';
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `${remainingMinutes} min left`;
}

function getGroupTimerState(group, nowMs) {
  const paused = Number(group.section_timer_paused) === 1;
  const durationMinutes = Number(group.section_timer_duration_minutes || 0);
  const startedAt = group.section_timer_started_at
    ? parseUtcDbDatetime(group.section_timer_started_at)
    : null;
  const pausedAt = group.section_timer_paused_at
    ? parseUtcDbDatetime(group.section_timer_paused_at)
    : null;

  if (paused) {
    return { label: 'Paused', bg: 'secondary', text: 'light' };
  }

  if (!startedAt || durationMinutes <= 0) {
    return { label: 'Waiting', bg: 'warning', text: 'dark' };
  }

  const durationMs = durationMinutes * 60 * 1000;
  const effectiveNowMs = paused && pausedAt ? pausedAt.getTime() : nowMs;
  const remainingMs = durationMs - (effectiveNowMs - startedAt.getTime());
  const ratio = durationMs > 0 ? remainingMs / durationMs : 0;

  if (remainingMs <= 0) {
    return { label: 'Time out', bg: 'danger', text: 'light' };
  }

  if (ratio <= 0.2) {
    return { label: formatTimerMinutesLabel(remainingMs), bg: 'warning', text: 'dark' };
  }

  return { label: formatTimerMinutesLabel(remainingMs), bg: 'success', text: 'light' };
}

export default function ViewGroupsPage() {
  const { courseId, activityId } = useParams();
  const location = useLocation();
  const incomingCourseName = location.state && location.state.courseName;
  const navigate = useNavigate();
  const { user } = useUser();

  const [activityTitle, setActivityTitle] = useState('');
  const [courseName, setCourseName] = useState(incomingCourseName || '');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(new Set());
  const [deleting, setDeleting] = useState(new Set());

  // Live-edit state
  const [available, setAvailable] = useState([]);
  const [active, setActive] = useState([]);
  const [selectedAdd, setSelectedAdd] = useState('');
  const [selectedRemove, setSelectedRemove] = useState('');
  const [togglingPause, setTogglingPause] = useState(false);
  const [rotationMode, setRotationMode] = useState('submit');
  const [updatingRotationMode, setUpdatingRotationMode] = useState(false);
  const [rotatingGroups, setRotatingGroups] = useState(new Set());
  const [timerNowMs, setTimerNowMs] = useState(() => Date.now());
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isDemoClass, setIsDemoClass] = useState(false);
  const [clearingDemoRoster, setClearingDemoRoster] = useState(false);
  const isDemoInstructor = user?.demo_mode === 'instructor';

  const fetchGroups = async ({ quiet = false } = {}) => {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

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
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        setRotationMode(String(data.groups[0].active_rotation_mode || 'submit'));
      }
      setHasLoadedOnce(true);
    } catch (err) {
      console.error('❌ Error loading groups:', err);
      setError(err?.message || 'Could not load groups.');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (!courseId || !activityId) return;
    fetchGroups({ quiet: false });
    const interval = setInterval(() => {
      fetchGroups({ quiet: true });
    }, 5000);
    return () => clearInterval(interval);
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

  useEffect(() => {
    let cancelled = false;

    async function fetchCourseInfo() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/courses/${courseId}/info`, {
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load course info');
        if (!cancelled) {
          setIsDemoClass(Boolean(data?.class_demo_mode));
        }
      } catch (err) {
        console.error('❌ Error fetching course info:', err);
      }
    }

    if (courseId) fetchCourseInfo();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  useEffect(() => {
    const interval = setInterval(() => setTimerNowMs(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

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

  const deleteInstance = async (instanceId) => {
    const confirmed = window.confirm(
      'Delete this activity instance permanently? This removes its members, saved drafts, submissions, scores, and feedback. This cannot be undone.'
    );
    if (!confirmed) return;

    setDeleting((previous) => new Set(previous).add(instanceId));
    try {
      const response = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data?.error || 'Failed to delete the activity instance.');
      await Promise.all([fetchGroups(), refreshStudents()]);
    } catch (err) {
      console.error('Delete activity instance failed:', err);
      alert(err?.message || 'Failed to delete the activity instance.');
    } finally {
      setDeleting((previous) => {
        const next = new Set(previous);
        next.delete(instanceId);
        return next;
      });
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

  const anyStudentsActive = groups.some((group) =>
    (group.members || []).some((member) => member.connected)
  );
  const timerPaused = groups.some((group) => Number(group.section_timer_paused) === 1);

  let timerButtonVariant = 'warning';
  let timerButtonLabel = 'Waiting';
  if (timerPaused) {
    timerButtonVariant = 'danger';
    timerButtonLabel = 'Paused';
  } else if (anyStudentsActive) {
    timerButtonVariant = 'success';
    timerButtonLabel = 'Running';
  }

  const handleTogglePause = async () => {
    setTogglingPause(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}/timer-pause`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paused: !timerPaused }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update timer pause state');
      await fetchGroups();
    } catch (err) {
      console.error('❌ Error toggling timer pause:', err);
      alert(err?.message || 'Failed to update timer pause state');
    } finally {
      setTogglingPause(false);
    }
  };

  const handleSetRotationMode = async (mode) => {
    if (!mode || mode === rotationMode) return;
    setUpdatingRotationMode(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}/active-rotation-mode`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ mode }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update active rotation mode');
      setRotationMode(data?.mode || mode);
      await fetchGroups();
    } catch (err) {
      console.error('❌ Error updating active rotation mode:', err);
      alert(err?.message || 'Failed to update active rotation mode');
    } finally {
      setUpdatingRotationMode(false);
    }
  };

  const handleRotateActiveMember = async (group) => {
    const connectedMembers = getConnectedMembers(group);
    if (connectedMembers.length < 2) return;

    const currentActive = getActiveMember(group) || connectedMembers[0];
    const currentStudentId = Number(currentActive?.student_id);
    if (!Number.isFinite(currentStudentId) || currentStudentId <= 0) return;

    const instanceId = Number(group.instance_id);
    if (!instanceId) return;

    setRotatingGroups((prev) => {
      const next = new Set(prev);
      next.add(instanceId);
      return next;
    });

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/rotate-active-student`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ currentStudentId }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to rotate active student');
      await fetchGroups({ quiet: true });
    } catch (err) {
      console.error('❌ Error rotating active student:', err);
      alert(err?.message || 'Failed to rotate active student.');
    } finally {
      setRotatingGroups((prev) => {
        const next = new Set(prev);
        next.delete(instanceId);
        return next;
      });
    }
  };

  const handleClearDemoRoster = async () => {
    if (!window.confirm('Clear all students, groups, and saved work for this demo activity? This cannot be undone.')) {
      return;
    }

    setClearingDemoRoster(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}/demo-roster`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to clear demo roster');
      }

      setSelectedAdd('');
      setSelectedRemove('');
      await Promise.all([refreshStudents(), fetchGroups()]);
    } catch (err) {
      console.error('❌ Error clearing demo roster:', err);
      alert(err?.message || 'Failed to clear demo roster');
    } finally {
      setClearingDemoRoster(false);
    }
  };

  return (
    <Container className="mt-4">
      <div
        className="sticky-top mb-4"
        style={{
          top: '70px',
          zIndex: 1020,
          background: '#fff',
          borderBottom: '1px solid #dee2e6',
          boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
        }}
      >
        <div className="d-flex align-items-center justify-content-between gap-3 py-3 flex-wrap">
          <div>
            <h2 className="mb-1">
              {activityTitle ? `Activity: ${activityTitle}` : 'Groups for Activity'}
            </h2>
            {courseName && <div className="text-muted">{courseName}</div>}
          </div>
          <Button
            variant={timerButtonVariant}
            onClick={handleTogglePause}
            disabled={togglingPause}
          >
            {togglingPause ? 'Updating…' : timerButtonLabel}
          </Button>
        </div>

        {isDemoClass && (
          <div className="pb-3">
            <Button
              variant="outline-danger"
              onClick={handleClearDemoRoster}
              disabled={clearingDemoRoster || isDemoInstructor}
              title={isDemoInstructor ? 'Disabled in instructor demo mode' : undefined}
            >
              {clearingDemoRoster ? 'Clearing Demo…' : 'Clear Demo Students & Groups'}
            </Button>
          </div>
        )}

      </div>

      {loading && !hasLoadedOnce ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : groups.length === 0 ? (
        <Alert variant="info">No groups available.</Alert>
      ) : (
        <>
          {isDemoInstructor ? (
            <Alert variant="info" className="mb-3">
              Demo instructor mode: roster and rotation controls are visible but disabled. Use <strong>View Activity</strong> to open the group activity.
            </Alert>
          ) : null}
          <Row>
          {groups.map((group) => {
            const isComplete = isCompleteFromInstanceRow(group);
            const timerState = getGroupTimerState(group, timerNowMs);
            const instanceId = Number(group.instance_id);
            const connectedMembers = getConnectedMembers(group);
            const activeMember = getActiveMember(group);
            const canRotateActive = !isComplete && connectedMembers.length > 1;

            return (
              <Col lg={4} md={6} sm={12} key={group.instance_id}>
                <Card className="mb-3">
                  <Card.Header className="d-flex justify-content-between align-items-center flex-wrap">
                    <div>
                      Group {group.group_number} —{' '}
                      <strong className="ms-2">{progressLabelFromInstanceRow(group)}</strong>
                    </div>

                    <div className="d-flex gap-2 mt-2 mt-sm-0 flex-wrap align-items-center">
                      <Badge bg={timerState.bg} text={timerState.text}>
                        {timerState.label}
                      </Badge>
                      {canRotateActive ? (
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          disabled={rotatingGroups.has(instanceId)}
                          onClick={() => handleRotateActiveMember(group)}
                          title={
                            activeMember
                              ? `Pass active control from ${activeMember.name} to another connected member`
                              : 'Pass active control to another connected member'
                          }
                        >
                          {rotatingGroups.has(instanceId) ? 'Rotating…' : (
                            <>
                              <FaRandom className="me-1" />
                              Rotate active
                            </>
                          )}
                        </Button>
                      ) : null}
                      {!isDemoInstructor ? (
                        <Button
                          variant="outline-danger"
                          size="sm"
                          disabled={clearing.has(group.instance_id) || timerPaused}
                          onClick={() => clearGroupAnswers(group.instance_id)}
                        >
                          {clearing.has(group.instance_id) ? 'Clearing…' : 'Clear Answers'}
                        </Button>
                      ) : null}

                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deleting.has(instanceId)}
                        onClick={() => deleteInstance(instanceId)}
                      >
                        {deleting.has(instanceId) ? 'Deleting…' : 'Delete Instance'}
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
                          {m.name}
                          {!isDemoClass && m.email ? (
                            <>
                              {' '}
                              <span className="text-muted">&lt;{m.email}&gt;</span>
                            </>
                          ) : null}
                          {group.active_student_id === m.student_id && (
                            <FaUserCheck title="Active student" className="text-success ms-1" />
                          )}
                          {m.connected && <FaLaptop title="Connected" className="text-info ms-1" />}
                          {m.role && <span className="ms-2 text-muted">({m.role})</span>}
                        </li>
                      ))}
                    </ul>
                    {group.assignment_due_at ? (
                      <div className="small mb-2">
                        <strong>Due:</strong> {formatUtcToLocal(group.assignment_due_at)}
                        {group.submitted_at ? (
                          <span className={group.submitted_late ? 'text-warning-emphasis' : 'text-success'}>
                            {group.submitted_late ? ' · Submitted late' : ' · Submitted on time'}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <GroupProgressBars group={group} />
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
          </Row>
        </>
      )}

      <Card className="my-4">
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div>
              <div className="fw-semibold">Active-student rotation</div>
              <div className="small text-muted">
                Choose whether the active student changes on every submit or only when the group advances to the next question group.
              </div>
            </div>
            {isDemoInstructor ? (
              <div className="small text-muted">Instructor demo mode: controls are shown but disabled.</div>
            ) : null}
            <ButtonGroup>
              <Button
                variant={rotationMode === 'submit' ? 'primary' : 'outline-primary'}
                disabled={updatingRotationMode || isDemoInstructor}
                onClick={() => handleSetRotationMode('submit')}
              >
                Submit
              </Button>
              <Button
                variant={rotationMode === 'group' ? 'primary' : 'outline-primary'}
                disabled={updatingRotationMode || isDemoInstructor}
                onClick={() => handleSetRotationMode('group')}
              >
                Q Group
              </Button>
            </ButtonGroup>
          </div>

          <div className="d-flex gap-3 align-items-center flex-wrap">
            <Form.Select
              value={selectedAdd}
              onChange={(e) => setSelectedAdd(e.target.value)}
              style={{ maxWidth: 320 }}
              disabled={timerPaused || isDemoInstructor}
            >
              <option value="">Add student...</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email})
                </option>
              ))}
            </Form.Select>

            <div className="d-flex gap-2">
              <Button
                variant="primary"
                onClick={handleAddToGroup}
                disabled={!selectedAdd || timerPaused || isDemoInstructor}
              >
                Add to group
              </Button>
              <Button
                variant="outline-secondary"
                onClick={handleAddAsSoloGroup}
                disabled={!selectedAdd || timerPaused || isDemoInstructor}
              >
                Group of one
              </Button>
            </div>

            <Form.Select
              value={selectedRemove}
              onChange={(e) => setSelectedRemove(e.target.value)}
              style={{ maxWidth: 380 }}
              disabled={timerPaused || isDemoInstructor}
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

            <Button
              variant="danger"
              onClick={handleRemove}
              disabled={!selectedRemove || timerPaused || isDemoInstructor}
            >
              Remove
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
}
