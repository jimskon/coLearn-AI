import React from 'react';
import { Alert, Badge, Button, Card, Col, Container, Row, Spinner, Table } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

const summaryCards = [
  { key: 'totalEvents', label: 'Events' },
  { key: 'submitEvents', label: 'Submits' },
  { key: 'loginEvents', label: 'Logins' },
  { key: 'accountEvents', label: 'Accounts' },
  { key: 'classEvents', label: 'Classes' },
  { key: 'activityEvents', label: 'Activities' },
  { key: 'instanceEvents', label: 'Instances' },
  { key: 'groupsEvents', label: 'Groups' },
];

function humanizeEventType(eventType) {
  return String(eventType || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatScope(row) {
  const pieces = [];
  if (row.courseName) pieces.push(row.courseName);
  if (row.className) pieces.push(row.className);
  if (row.activityTitle) pieces.push(row.activityTitle);
  if (row.activityInstanceId) pieces.push(`Instance ${row.activityInstanceId}`);
  return pieces.length ? pieces.join(' · ') : '—';
}

function detailsSummary(details) {
  if (!details) return '—';
  if (typeof details === 'string') return details.length > 120 ? `${details.slice(0, 117)}…` : details;
  try {
    const text = JSON.stringify(details);
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  } catch {
    return '—';
  }
}

export default function AuditLogPage() {
  const { user, loading } = useUser();
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [data, setData] = React.useState({
    summary: {},
    byEventType: [],
    submitsByActivity: [],
    recent: [],
  });

  React.useEffect(() => {
    if (loading) return;
    if (user?.role !== 'root') {
      navigate('/dashboard');
      return;
    }

    let cancelled = false;
    const load = async () => {
      setBusy(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/audit/logs?limit=200`, {
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error || 'Failed to load logs');
        }
        if (!cancelled) {
          setData({
            summary: json.summary || {},
            byEventType: Array.isArray(json.byEventType) ? json.byEventType : [],
            submitsByActivity: Array.isArray(json.submitsByActivity) ? json.submitsByActivity : [],
            recent: Array.isArray(json.recent) ? json.recent : [],
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load logs');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [loading, navigate, user]);

  if (loading || busy) {
    return (
      <Container className="py-5" style={{ marginTop: '4.5rem' }}>
        <Spinner animation="border" />
      </Container>
    );
  }

  if (user?.role !== 'root') return null;

  return (
    <Container className="py-4" style={{ marginTop: '4.5rem' }}>
      <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap mb-4">
        <div>
          <h1 className="h2 mb-1">Audit Log</h1>
          <div className="text-muted">
            A compact summary of system events, submissions, and recent activity.
          </div>
        </div>
        <Button as={Link} to="/admin/users" variant="outline-secondary">
          Manage Users
        </Button>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Row className="g-3 mb-4">
        {summaryCards.map((card) => (
          <Col key={card.key} xs={6} md={3}>
            <Card className="h-100">
              <Card.Body>
                <div className="text-muted small text-uppercase">{card.label}</div>
                <div className="display-6 mb-0">{Number(data.summary?.[card.key] || 0)}</div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Row className="g-4 mb-4">
        <Col lg={5}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">Event Types</Card.Header>
            <Card.Body className="p-0">
              <Table striped hover responsive className="mb-0">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="text-end">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byEventType.length ? data.byEventType.map((row) => (
                    <tr key={row.eventType}>
                      <td>{humanizeEventType(row.eventType)}</td>
                      <td className="text-end">{row.count}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={2} className="text-center text-muted py-4">No audit rows yet.</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={7}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">Top Submits</Card.Header>
            <Card.Body className="p-0">
              <Table striped hover responsive className="mb-0">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Scope</th>
                    <th className="text-end">Submits</th>
                    <th className="text-end">Instances</th>
                    <th>Last Submit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.submitsByActivity.length ? data.submitsByActivity.map((row) => (
                    <tr key={`${row.activityId}-${row.activityLabel}`}>
                      <td>{row.activityLabel}</td>
                      <td>
                        <div className="small text-muted">{row.courseLabel}</div>
                        <div>{row.classLabel}</div>
                      </td>
                      <td className="text-end">{row.submitCount}</td>
                      <td className="text-end">{row.instanceCount}</td>
                      <td>{formatTime(row.lastSubmitAt)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={5} className="text-center text-muted py-4">No submit events yet.</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card>
        <Card.Header className="fw-semibold">Recent Events</Card.Header>
        <Card.Body className="p-0">
          <Table striped hover responsive className="mb-0">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>User</th>
                <th>Scope</th>
                <th>Path</th>
                <th>IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.length ? data.recent.map((row) => (
                <tr key={row.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatTime(row.createdAt)}</td>
                  <td>
                    <Badge bg="secondary">{humanizeEventType(row.eventType)}</Badge>
                  </td>
                  <td>
                    <div>{row.userName || row.userEmail || 'Guest'}</div>
                    <div className="small text-muted">{row.role || row.guestToken || '—'}</div>
                  </td>
                  <td>{formatScope(row)}</td>
                  <td style={{ maxWidth: 180, wordBreak: 'break-word' }}>{row.requestPath || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row.ipAddress || '—'}</td>
                  <td style={{ maxWidth: 280, wordBreak: 'break-word' }}>{detailsSummary(row.details)}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-4">No recent audit events yet.</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </Container>
  );
}
