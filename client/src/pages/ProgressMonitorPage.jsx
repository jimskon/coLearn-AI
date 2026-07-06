import React from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, Row, Spinner, Table } from 'react-bootstrap';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';

import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';
import { formatLocalDateTime } from '../utils/time';

const STATUS_LABELS = {
  active_thinking: 'Active thinking',
  needs_check_in: 'Needs check-in',
  stuck_after_feedback: 'Stuck after feedback',
  falling_behind: 'Falling behind',
  completed: 'Completed',
  pending: 'Pending',
};

const STATUS_VARIANTS = {
  active_thinking: 'success',
  needs_check_in: 'warning',
  stuck_after_feedback: 'danger',
  falling_behind: 'secondary',
  completed: 'primary',
  pending: 'light',
};

function formatDuration(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function statusLabel(value) {
  return STATUS_LABELS[String(value || '').toLowerCase()] || 'Pending';
}

function statusVariant(value) {
  return STATUS_VARIANTS[String(value || '').toLowerCase()] || 'light';
}

function summarizeRows(rows = []) {
  const summary = { totalGroups: 0, byStatus: {} };
  for (const row of rows) {
    summary.totalGroups += 1;
    const key = String(row?.currentStatus || 'pending').toLowerCase();
    summary.byStatus[key] = (summary.byStatus[key] || 0) + 1;
  }
  return summary;
}

function buildScopeQuery(courseId, activityId) {
  const params = new URLSearchParams();
  if (courseId) params.set('courseId', courseId);
  if (activityId) params.set('activityId', activityId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export default function ProgressMonitorPage() {
  const { user, loading } = useUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('courseId') || '';
  const activityId = searchParams.get('activityId') || '';
  const [loadingBoard, setLoadingBoard] = React.useState(false);
  const [error, setError] = React.useState('');
  const [scope, setScope] = React.useState({
    courseId: null,
    activityId: null,
    courseName: null,
    courseCode: null,
    section: null,
    semester: null,
    year: null,
    activityTitle: null,
  });
  const [rows, setRows] = React.useState([]);
  const [clockTick, setClockTick] = React.useState(0);
  const socketRef = React.useRef(null);

  const isInstructorLike = React.useMemo(
    () => ['root', 'creator', 'instructor'].includes(String(user?.role || '').toLowerCase()),
    [user?.role]
  );

  React.useEffect(() => {
    if (loading) return;
    if (!isInstructorLike) {
      navigate('/dashboard');
    }
  }, [loading, isInstructorLike, navigate]);

  React.useEffect(() => {
    const tick = window.setInterval(() => setClockTick((value) => value + 1), 30000);
    return () => window.clearInterval(tick);
  }, []);

  React.useEffect(() => {
    if (!isInstructorLike) return;
    if (!courseId && !activityId) {
      setRows([]);
      setScope({
        courseId: null,
        activityId: null,
        courseName: null,
        courseCode: null,
        section: null,
        semester: null,
        year: null,
        activityTitle: null,
      });
      return;
    }

    let cancelled = false;
    const loadBoard = async () => {
      setLoadingBoard(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/progress-monitor/statuses${buildScopeQuery(courseId, activityId)}`, {
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error || 'Failed to load progress monitor');
        }
        if (cancelled) return;
        setScope(json.scope || {});
        setRows(Array.isArray(json.rows) ? json.rows : []);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load progress monitor');
        }
      } finally {
        if (!cancelled) setLoadingBoard(false);
      }
    };

    loadBoard();
    return () => {
      cancelled = true;
    };
  }, [courseId, activityId, isInstructorLike]);

  React.useEffect(() => {
    if (!isInstructorLike) return undefined;
    if (!courseId && !activityId) return undefined;

    const socket = io(API_BASE_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('progress-monitor:join', {
        courseId: activityId ? null : courseId || null,
        activityId: activityId || null,
      });
    });

    const handleProgressStatus = (msg) => {
      const instanceId = Number(msg?.activityInstanceId ?? msg?.instanceId);
      if (!Number.isFinite(instanceId)) return;

      setRows((prev) => prev.map((row) => {
        if (Number(row.activityInstanceId) !== instanceId) return row;
        const nextStatus = String(msg?.newStatus || '').toLowerCase();
        return {
          ...row,
          currentStatus: nextStatus || row.currentStatus,
          previousStatus: String(msg?.previousStatus || '').toLowerCase() || row.previousStatus || null,
          statusUpdatedAt: msg?.ts ? new Date(msg.ts).toISOString() : new Date().toISOString(),
          statusAgeMs: 0,
          statusAgeLabel: '0s',
        };
      }));
    };

    const handleProgressSuggestion = (msg) => {
      const instanceId = Number(msg?.activityInstanceId);
      if (!Number.isFinite(instanceId)) return;

      setRows((prev) => prev.map((row) => {
        if (Number(row.activityInstanceId) !== instanceId) return row;
        const suggestion = msg?.suggestionId == null ? row.suggestion : {
          id: Number(msg.suggestionId),
          auditLogId: msg?.auditLogId == null ? null : Number(msg.auditLogId),
          previousStatus: String(msg?.previousStatus || '').toLowerCase() || null,
          status: String(msg?.status || '').toLowerCase() || null,
          text: msg?.suggestionText || null,
          state: msg?.suggestionState || null,
          generatedAt: msg?.generatedAt || row.suggestion?.generatedAt || null,
          dismissedAt: msg?.dismissedAt || row.suggestion?.dismissedAt || null,
          actedOnAt: msg?.actedOnAt || row.suggestion?.actedOnAt || null,
          updatedAt: msg?.updatedAt || row.suggestion?.updatedAt || null,
        };
        return { ...row, suggestion };
      }));
    };

    socket.on('progress:status', handleProgressStatus);
    socket.on('progress:suggestion', handleProgressSuggestion);

    return () => {
      socket.emit('progress-monitor:leave', {
        courseId: activityId ? null : courseId || null,
        activityId: activityId || null,
      });
      socket.off('progress:status', handleProgressStatus);
      socket.off('progress:suggestion', handleProgressSuggestion);
      socket.disconnect();
    };
  }, [courseId, activityId, isInstructorLike]);

  const submitSuggestionAction = async (suggestionId, action) => {
    if (!suggestionId) return;
    try {
      const res = await fetch(API_BASE_URL + "/api/progress-monitor/suggestions/" + suggestionId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update suggestion");
      const updated = json?.suggestion || null;
      if (updated) {
        setRows((prev) => prev.map((row) => (Number(row.suggestion?.id) === Number(updated.id) ? { ...row, suggestion: { ...row.suggestion, ...updated, id: Number(updated.id) } } : row)));
      }
    } catch (err) {
      setError(err?.message || "Failed to update suggestion");
    }
  };

  const summary = React.useMemo(() => summarizeRows(rows), [rows, clockTick]);

  const headerTitle = scope.activityTitle
    ? `Progress Monitor · ${scope.activityTitle}`
    : scope.courseName
      ? `Progress Monitor · ${scope.courseName}`
      : 'Progress Monitor';

  const scopeLine = [
    scope.courseCode ? `${scope.courseCode}` : null,
    scope.courseName || null,
    scope.section ? `Section ${scope.section}` : null,
    scope.semester ? String(scope.semester).toUpperCase() : null,
    scope.year ? String(scope.year) : null,
  ].filter(Boolean).join(' · ');

  if (loading || !isInstructorLike) {
    return (
      <Container className="py-5" style={{ marginTop: '4.5rem' }}>
        <Spinner animation="border" />
      </Container>
    );
  }

  return (
    <Container className="py-4" style={{ marginTop: '4.5rem' }}>
      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-4">
        <div>
          <h1 className="h2 mb-1">{headerTitle}</h1>
          <div className="text-muted">
            Live instructor view of group status. Read-only; updates arrive over Socket.IO.
          </div>
          {scopeLine ? <div className="text-muted small mt-1">{scopeLine}</div> : null}
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <Button as={Link} to="/admin/logs" variant="outline-secondary">
            Audit Log
          </Button>
          <Button as={Link} to="/manage-courses" variant="outline-secondary">
            Courses
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <Card.Body>
          <Form className="row g-3 align-items-end" onSubmit={(e) => {
            e.preventDefault();
            const nextCourseId = e.currentTarget.elements.courseId.value.trim();
            const nextActivityId = e.currentTarget.elements.activityId.value.trim();
            navigate(`/progress-monitor${buildScopeQuery(nextCourseId, nextActivityId)}`);
          }}>
            <Col md={4}>
              <Form.Label>Course ID</Form.Label>
              <Form.Control name="courseId" defaultValue={courseId} placeholder="e.g. 12" />
            </Col>
            <Col md={4}>
              <Form.Label>Activity ID</Form.Label>
              <Form.Control name="activityId" defaultValue={activityId} placeholder="e.g. 44" />
            </Col>
            <Col md={4} className="d-flex gap-2">
              <Button type="submit" variant="primary">
                Load
              </Button>
              <Button
                type="button"
                variant="outline-secondary"
                onClick={() => navigate('/progress-monitor')}
              >
                Clear
              </Button>
            </Col>
          </Form>
        </Card.Body>
      </Card>

      {error ? <Alert variant="danger">{error}</Alert> : null}
      {!courseId && !activityId ? (
        <Alert variant="info">
          Enter a course ID or activity ID above, or open this page from a course activity row.
        </Alert>
      ) : null}

      <Row className="g-3 mb-4">
        <Col xs={6} md={4} lg={2}>
          <Card className="h-100">
            <Card.Body>
              <div className="text-muted small text-uppercase">Groups</div>
              <div className="display-6 mb-0">{summary.totalGroups}</div>
            </Card.Body>
          </Card>
        </Col>
        {['active_thinking', 'needs_check_in', 'stuck_after_feedback', 'falling_behind', 'completed'].map((status) => (
          <Col key={status} xs={6} md={4} lg={2}>
            <Card className="h-100">
              <Card.Body>
                <div className="text-muted small text-uppercase">{statusLabel(status)}</div>
                <div className="display-6 mb-0">{Number(summary.byStatus?.[status] || 0)}</div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Card>
        <Card.Header className="fw-semibold d-flex justify-content-between align-items-center gap-3 flex-wrap">
          <span>Group Status</span>
          {loadingBoard ? <Spinner animation="border" size="sm" /> : null}
        </Card.Header>
        <Card.Body className="p-0">
          <Table striped hover responsive className="mb-0">
            <thead>
              <tr>
                <th>Course / Activity</th>
                <th>Group</th>
                <th>Status</th>
                <th>Time in Status</th>
                <th>Updated</th>
                <th>Members</th>
                <th>Active Student</th>
                <th>Suggestion</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => {
                const currentStatus = row.currentStatus || row.suggestion?.status || 'pending';
                const elapsedLabel = row.statusUpdatedAt ? formatDuration(Date.now() - new Date(row.statusUpdatedAt).getTime()) : '—';
                return (
                  <tr key={row.activityInstanceId}>
                    <td>
                      <div className="fw-semibold">{row.courseName || '—'}</div>
                      <div className="small text-muted">{row.activityTitle || '—'}</div>
                    </td>
                    <td>{row.groupNumber ?? '—'}</td>
                    <td>
                      <Badge bg={statusVariant(currentStatus)} text={currentStatus === 'pending' ? 'dark' : undefined}>
                        {statusLabel(currentStatus)}
                      </Badge>
                    </td>
                    <td>{currentStatus === 'pending' ? 'Waiting for first status event' : elapsedLabel}</td>
                    <td>{formatLocalDateTime(row.statusUpdatedAt)}</td>
                    <td>
                      <div>{row.memberNames?.length ? row.memberNames.join(', ') : '—'}</div>
                      {row.memberCount ? <div className="small text-muted">{row.memberCount} member{row.memberCount === 1 ? '' : 's'}</div> : null}
                    </td>
                    <td>
                      <div>{row.activeStudentName || '—'}</div>
                      {row.activeStudentEmail ? <div className="small text-muted">{row.activeStudentEmail}</div> : null}
                    </td>
                    <td>
                      {row.suggestion ? (
                        <div className="d-grid gap-2">
                          <div>
                            <Badge bg={row.suggestion.state === 'pending' ? 'warning' : row.suggestion.state === 'acted_on' ? 'success' : 'secondary'} text={row.suggestion.state === 'pending' ? 'dark' : undefined}>
                              {row.suggestion.state || 'pending'}
                            </Badge>
                          </div>
                          <div className="small">{row.suggestion.text}</div>
                          {row.suggestion.state === 'pending' ? (
                            <div className="d-flex gap-2 flex-wrap">
                              <Button size="sm" variant="outline-secondary" onClick={() => submitSuggestionAction(row.suggestion.id, 'dismissed')}>Dismiss</Button>
                              <Button size="sm" variant="outline-success" onClick={() => submitSuggestionAction(row.suggestion.id, 'acted_on')}>Acted on</Button>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-4">
                    {loadingBoard ? 'Loading progress data...' : 'No groups found for this scope.'}
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </Container>
  );
}
