import React from 'react';
import { Alert, Button, Container, Form, Spinner, Table } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';
import { formatInterestSummary } from '../components/demo/demoInfoRequestFields';

const allowedRoles = new Set(['root', 'creator', 'instructor']);
const statusOptions = ['new', 'contacted', 'follow_up', 'closed'];

function formatInterestText(row) {
  const items = formatInterestSummary(row);
  return items.length ? items.join(', ') : 'None';
}

function messagePreview(message) {
  const text = String(message || '').trim();
  if (!text) return '—';
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export default function DemoInfoRequestsAdminPage({ defaultDemoCode = '' }) {
  const { demoCode: routeDemoCode = '' } = useParams();
  const demoCode = routeDemoCode || defaultDemoCode || 'aied2026';
  const { user, loading } = useUser();
  const navigate = useNavigate();
  const [rows, setRows] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [savedRowId, setSavedRowId] = React.useState(null);

  React.useEffect(() => {
    if (loading) return;
    if (!user || !allowedRoles.has(user.role)) {
      navigate('/dashboard');
      return;
    }

    let cancelled = false;
    const loadRows = async () => {
      setBusy(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/demo/${encodeURIComponent(demoCode)}/admin/info-requests`, {
          credentials: 'include',
        });
        const data = await res.json().catch(() => []);
        if (!res.ok) {
          throw new Error(data?.error || 'Unable to load requests');
        }
        if (!cancelled) {
          setRows(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Unable to load requests');
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };

    loadRows();
    return () => {
      cancelled = true;
    };
  }, [demoCode, loading, navigate, user]);

  const updateRow = (id, patch) => {
    setRows((prev) => prev.map((row) => (Number(row.id) === Number(id) ? { ...row, ...patch } : row)));
  };

  const saveRow = async (row) => {
    setError('');
    setSavedRowId(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/${encodeURIComponent(demoCode)}/admin/info-requests/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status: row.status,
          notes: row.notes || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to save request');
      }
      if (data?.request) {
        updateRow(row.id, data.request);
      }
      setSavedRowId(row.id);
    } catch (err) {
      setError(err?.message || 'Unable to save request');
    }
  };

  if (!loading && (!user || !allowedRoles.has(user.role))) {
    return null;
  }

  if (loading || (busy && rows.length === 0)) {
    return (
      <Container className="py-5" style={{ marginTop: '4.5rem' }}>
        <Spinner animation="border" />
      </Container>
    );
  }

  return (
    <Container className="py-5" style={{ marginTop: '4.5rem' }}>
      <div className="d-flex justify-content-between align-items-center gap-3 mb-4">
        <div>
          <h1 className="h2 mb-1">Info Requests</h1>
          <div className="text-muted">Demo code: <code>{demoCode}</code></div>
        </div>
        <Button as={Link} to={`/demo/${encodeURIComponent(demoCode)}`} variant="outline-secondary">
          Back to Demo
        </Button>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}
      {savedRowId ? <Alert variant="success">Saved request updates.</Alert> : null}

      <Table striped bordered hover responsive>
        <thead>
          <tr>
            <th>Created</th>
            <th>Name</th>
            <th>Email</th>
            <th>Institution</th>
            <th>Role</th>
            <th>Interests</th>
            <th>Message</th>
            <th>Status</th>
            <th>Notes</th>
            <th>Save</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.id}>
              <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
              <td>{row.name || '—'}</td>
              <td>{row.email || '—'}</td>
              <td>{row.institution || '—'}</td>
              <td>{row.role || '—'}</td>
              <td style={{ minWidth: '180px' }}>{formatInterestText(row)}</td>
              <td style={{ minWidth: '220px' }}>{messagePreview(row.message)}</td>
              <td style={{ minWidth: '140px' }}>
                <Form.Select
                  value={row.status || 'new'}
                  onChange={(event) => updateRow(row.id, { status: event.target.value })}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Form.Select>
              </td>
              <td style={{ minWidth: '240px' }}>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={row.notes || ''}
                  onChange={(event) => updateRow(row.id, { notes: event.target.value })}
                />
              </td>
              <td>
                <Button variant="primary" size="sm" onClick={() => saveRow(row)}>
                  Save
                </Button>
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={10} className="text-center text-muted py-4">
                No info requests yet.
              </td>
            </tr>
          )}
        </tbody>
      </Table>
    </Container>
  );
}
