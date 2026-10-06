import React from 'react';
import { Alert, Button, Card, Col, Container, Form, Nav, Row, Spinner, Table } from 'react-bootstrap';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from '../../config';
import { useUser } from '../../context/UserContext';
import activityGrammar from '../../../../shared/activityGrammar.cjs';

const RESEARCH_ROLES = ['root', 'instructor', 'creator'];
const QUESTION_TYPES = [...activityGrammar.ENUMS.questiontype, 'unknown'];

export const RESEARCH_TABS = [
  { path: '', label: 'Overview' },
  { path: 'participation', label: 'Participation' },
  { path: 'ai-gating', label: 'AI Gating' },
  { path: 'revision', label: 'Revision' },
  { path: 'time', label: 'Time' },
  { path: 'group-size', label: 'Group Size' },
  { path: 'question-type', label: 'Question Type' },
  { path: 'over-time', label: 'Over Time' },
  { path: 'interventions', label: 'Interventions' },
  { path: 'exports', label: 'Exports' },
];

// Shared selections live in the URL so views can be bookmarked and every
// subpage sees the same selection.
function readSelection(params) {
  return {
    courseIds: (params.get('courses') || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0),
    from: params.get('from') || '',
    to: params.get('to') || '',
    groupSize: params.get('size') || 'all',
    questionType: params.get('qtype') || 'all',
    idleMinutes: params.get('idle') || '10',
  };
}

function writeSelection(params, selection) {
  const next = new URLSearchParams(params);
  const set = (key, value, empty) => {
    if (value === empty || value === '' || value == null) next.delete(key);
    else next.set(key, value);
  };
  set('courses', selection.courseIds.join(','), '');
  set('from', selection.from, '');
  set('to', selection.to, '');
  set('size', selection.groupSize, 'all');
  set('qtype', selection.questionType, 'all');
  set('idle', String(selection.idleMinutes), '10');
  return next;
}

export default function ResearchLayout() {
  const { user, loading } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [courses, setCourses] = React.useState([]);
  const [loadingCourses, setLoadingCourses] = React.useState(true);
  const [filter, setFilter] = React.useState('');
  const [draft, setDraft] = React.useState(() => readSelection(searchParams));
  const [showCourses, setShowCourses] = React.useState(() => readSelection(searchParams).courseIds.length === 0);

  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const allowed = RESEARCH_ROLES.includes(user?.role);

  React.useEffect(() => {
    if (loading) return;
    if (!allowed) {
      navigate('/dashboard');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/research/courses`, { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Failed to load courses');
        if (!cancelled) setCourses(Array.isArray(json.courses) ? json.courses : []);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load courses');
      } finally {
        if (!cancelled) setLoadingCourses(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loading, allowed, navigate]);

  // Recompute only when the applied selection changes, not when a subpage
  // stores its own view option (e.g. the Over Time grouping) in the URL.
  const appliedKey = writeSelection(new URLSearchParams(), readSelection(searchParams)).toString();
  React.useEffect(() => {
    const selection = readSelection(searchParams);
    setDraft(selection);
    if (!allowed || !selection.courseIds.length) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/research/metrics`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selection),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Failed to compute statistics');
        if (!cancelled) setResult(json);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to compute statistics');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey, allowed]);

  const visible = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) =>
      [c.label, c.code, c.instructorName, c.className].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [courses, filter]);

  const selected = new Set(draft.courseIds);
  const toggleCourse = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDraft((d) => ({ ...d, courseIds: [...next] }));
  };
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const toggleVisible = () => {
    const next = new Set(selected);
    for (const c of visible) {
      if (allVisibleSelected) next.delete(c.id);
      else next.add(c.id);
    }
    setDraft((d) => ({ ...d, courseIds: [...next] }));
  };

  const generate = () => {
    setShowCourses(false);
    setSearchParams(writeSelection(searchParams, draft));
  };

  if (loading || loadingCourses) {
    return (
      <Container className="py-5" style={{ marginTop: '4.5rem' }}>
        <Spinner animation="border" />
      </Container>
    );
  }
  if (!allowed) return null;

  const appliedCourseLabels = readSelection(searchParams).courseIds
    .map((id) => courses.find((c) => c.id === id)?.label)
    .filter(Boolean);

  return (
    <Container fluid="lg" className="py-4" style={{ marginTop: '4.5rem' }}>
      <div className="mb-3">
        <h1 className="h2 mb-1">Research Statistics</h1>
        <div className="text-muted">
          Participation, AI gating, revision, and timing reconstructed from the interaction trace.
          Tests, instructor sandbox runs, demo classes, and groups with no students are excluded and counted.
        </div>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <button type="button" className="btn btn-link p-0 text-decoration-none fw-semibold" onClick={() => setShowCourses((v) => !v)}>
            {showCourses ? '▾' : '▸'} Courses ({selected.size} selected)
          </button>
          <div className="small text-muted text-truncate" style={{ maxWidth: '60%' }}>
            {!showCourses && appliedCourseLabels.length ? appliedCourseLabels.join('; ') : null}
          </div>
        </Card.Header>
        {showCourses && (
          <>
            <Card.Body className="py-2 d-flex gap-2 flex-wrap">
              <Form.Control size="sm" placeholder="Filter by name, code, instructor…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 300 }} />
              <Button size="sm" variant="outline-secondary" onClick={toggleVisible}>
                {allVisibleSelected ? 'Clear shown' : 'Select shown'}
              </Button>
            </Card.Body>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <Table hover size="sm" className="mb-0">
                <tbody>
                  {visible.length ? visible.map((c) => (
                    <tr key={c.id} onClick={() => toggleCourse(c.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ width: 36 }}>
                        <Form.Check checked={selected.has(c.id)} onChange={() => toggleCourse(c.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${c.label}`} />
                      </td>
                      <td>
                        <div>{c.label}</div>
                        <div className="small text-muted">{c.code}</div>
                      </td>
                      <td className="small text-muted">{c.className || '—'}</td>
                      <td className="small text-muted">{c.instructorName || '—'}</td>
                    </tr>
                  )) : (
                    <tr><td className="text-muted text-center py-3">No courses match.</td></tr>
                  )}
                </tbody>
              </Table>
            </div>
          </>
        )}
        <Card.Footer>
          <Row className="g-2 align-items-end">
            <Col xs={6} md={2}>
              <Form.Label className="small mb-0">From</Form.Label>
              <Form.Control size="sm" type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small mb-0">To</Form.Label>
              <Form.Control size="sm" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small mb-0">Group size</Form.Label>
              <Form.Select size="sm" value={draft.groupSize} onChange={(e) => setDraft((d) => ({ ...d, groupSize: e.target.value }))}>
                <option value="all">All</option>
                <option value="2">2 students</option>
                <option value="3">3 students</option>
                <option value="4">4 students</option>
                <option value="other">Other sizes</option>
              </Form.Select>
            </Col>
            <Col xs={6} md={3}>
              <Form.Label className="small mb-0">Question type</Form.Label>
              <Form.Select size="sm" value={draft.questionType} onChange={(e) => setDraft((d) => ({ ...d, questionType: e.target.value }))}>
                <option value="all">All</option>
                {QUESTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Form.Select>
            </Col>
            <Col xs={6} md={1}>
              <Form.Label className="small mb-0" title="Gaps longer than this count only up to this many minutes toward time on task">Idle (min)</Form.Label>
              <Form.Control size="sm" type="number" min={1} max={120} value={draft.idleMinutes} onChange={(e) => setDraft((d) => ({ ...d, idleMinutes: e.target.value }))} />
            </Col>
            <Col xs={6} md={2} className="d-grid">
              <Button size="sm" onClick={generate} disabled={!draft.courseIds.length || busy}>
                {busy ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                Generate
              </Button>
            </Col>
          </Row>
        </Card.Footer>
      </Card>

      <Nav variant="tabs" className="mb-3 flex-nowrap overflow-auto" style={{ whiteSpace: 'nowrap' }}>
        {RESEARCH_TABS.map((tab) => {
          const pathname = tab.path ? `/research/${tab.path}` : '/research';
          const active = location.pathname.replace(/\/$/, '') === pathname;
          return (
            <Nav.Item key={tab.path || 'overview'}>
              <Nav.Link as={Link} to={{ pathname, search: location.search }} active={active}>
                {tab.label}
              </Nav.Link>
            </Nav.Item>
          );
        })}
      </Nav>

      {busy && !result ? (
        <div className="d-flex align-items-center gap-2 text-muted"><Spinner size="sm" animation="border" /> Computing…</div>
      ) : (
        <Outlet context={{ result, busy }} />
      )}
    </Container>
  );
}
