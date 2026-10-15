import React from 'react';
import { Alert, Button, Card, Col, Container, Form, Row, Spinner, Table } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

function show(value, suffix = '') {
  return value == null ? '—' : `${value}${suffix}`;
}

// One row per statistic: label, how to read it, and how to pull it from a summary.
const METRICS = [
  { group: 'Scale', label: 'Students enrolled', get: (s) => s.students.enrolled },
  { group: 'Scale', label: 'Students in at least one group', get: (s) => s.students.participating },
  { group: 'Scale', label: 'Groups (activity runs)', get: (s) => s.groups.count },
  { group: 'Scale', label: 'Average group size', get: (s) => s.groups.avgSize },
  { group: 'Scale', label: 'Distinct activities', get: (s) => s.activities },
  {
    group: 'Revision',
    label: 'Average revisions per question',
    help: 'Submitted versions of an answer (text or code), minus the first.',
    get: (s) => s.revisions.avgRevisionsPerQuestion,
  },
  {
    group: 'Revision',
    label: 'Questions answered',
    get: (s) => `${s.revisions.questions} (${s.revisions.codeQuestions} with code)`,
  },
  {
    group: 'Revision',
    label: 'Questions revised at least once',
    get: (s) => show(s.revisions.pctQuestionsRevised, '%'),
  },
  {
    group: 'Participation',
    label: 'Submit balance (0–1)',
    help: '1 = every member submitted equally often; 0 = one member submitted everything. Groups of 2+.',
    get: (s) => s.participation.avgBalance,
  },
  {
    group: 'Participation',
    label: 'Share of submits by the most active member',
    help: 'Average across groups. With 4 members, 25% is perfectly even.',
    get: (s) => show(s.participation.avgTopSubmitterSharePct, '%'),
  },
  {
    group: 'Participation',
    label: 'Members who submitted at least once',
    get: (s) => show(s.participation.pctMembersWhoSubmitted, '%'),
  },
  {
    group: 'AI gating',
    label: 'Questions the AI sent back at least once',
    help: 'Of text and code questions the AI evaluated.',
    get: (s) => `${show(s.aiGate.pctQuestionsSentBack, '%')} (${s.aiGate.questionsSentBack} of ${s.aiGate.evaluatedQuestions})`,
  },
  {
    group: 'AI gating',
    label: 'Group submits held back by the AI',
    help: 'Submits where the AI asked for a revision on at least one question, so the group could not advance.',
    get: (s) => `${show(s.aiGate.pctSubmitsHeldBackByAI, '%')} (${s.aiGate.heldBackByAI} of ${s.aiGate.groupSubmits})`,
  },
  {
    group: 'AI gating',
    label: 'Advanced with the Continue button',
    help: 'Group moved on after using up its retries rather than being accepted.',
    get: (s) => `${s.aiGate.advancedViaContinue} of ${s.aiGate.advanced} advances`,
  },
];

function toCsv(result) {
  const rows = [['Statistic', 'All selected', ...result.byCourse.map((c) => c.label)]];
  for (const m of METRICS) {
    rows.push([m.label, m.get(result.overall), ...result.byCourse.map((c) => m.get(c.stats))]);
  }
  return rows
    .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export default function StatisticsPage() {
  const { user, loading } = useUser();
  const navigate = useNavigate();
  const [courses, setCourses] = React.useState([]);
  const [selected, setSelected] = React.useState(() => new Set());
  const [filter, setFilter] = React.useState('');
  const [loadingCourses, setLoadingCourses] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState(null);

  React.useEffect(() => {
    if (loading) return;
    if (user?.role !== 'root') {
      navigate('/dashboard');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/stats/courses`, { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Failed to load courses');
        if (!cancelled) setCourses(Array.isArray(json.courses) ? json.courses : []);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load courses');
      } finally {
        if (!cancelled) setLoadingCourses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, navigate, user]);

  const visible = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) =>
      [c.label, c.code, c.instructorName, c.className].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [courses, filter]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = (on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of visible) {
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  };

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/stats/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseIds: [...selected] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Failed to generate statistics');
      setResult(json);
    } catch (err) {
      setError(err?.message || 'Failed to generate statistics');
    } finally {
      setGenerating(false);
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([toCsv(result)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colearn-statistics-${result.generatedAt.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || loadingCourses) {
    return (
      <Container className="py-5" style={{ marginTop: '4.5rem' }}>
        <Spinner animation="border" />
      </Container>
    );
  }

  if (user?.role !== 'root') return null;

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  return (
    <Container className="py-4" style={{ marginTop: '4.5rem' }}>
      <div className="mb-4">
        <h1 className="h2 mb-1">Statistics</h1>
        <div className="text-muted">
          Choose one or more courses and generate participation, revision, and AI-gating statistics.
          Tests and instructor sandbox runs are excluded.
        </div>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
          <span className="fw-semibold">Courses ({selected.size} selected)</span>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <Form.Control
              size="sm"
              placeholder="Filter by name, code, instructor…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: 260 }}
            />
            <Button size="sm" variant="outline-secondary" onClick={() => selectVisible(!allVisibleSelected)}>
              {allVisibleSelected ? 'Clear shown' : 'Select shown'}
            </Button>
            <Button size="sm" onClick={generate} disabled={!selected.size || generating}>
              {generating ? <Spinner size="sm" animation="border" className="me-1" /> : null}
              Generate
            </Button>
          </div>
        </Card.Header>
        <Card.Body className="p-0" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <Table hover responsive className="mb-0">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>Course</th>
                <th>Class</th>
                <th>Instructor</th>
                <th className="text-end">Enrolled</th>
                <th className="text-end">Runs</th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? visible.map((c) => (
                <tr key={c.id} onClick={() => toggle(c.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <Form.Check
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${c.label}`}
                    />
                  </td>
                  <td>
                    <div>{c.label}</div>
                    <div className="small text-muted">{c.code}</div>
                  </td>
                  <td>{c.className || '—'}</td>
                  <td>{c.instructorName || '—'}</td>
                  <td className="text-end">{c.enrolled}</td>
                  <td className="text-end">{c.instanceCount}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-4">No courses match.</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {result ? (
        <Card>
          <Card.Header className="d-flex justify-content-between align-items-center">
            <span className="fw-semibold">
              Results · {new Date(result.generatedAt).toLocaleString()}
            </span>
            <Button size="sm" variant="outline-secondary" onClick={downloadCsv}>
              Download CSV
            </Button>
          </Card.Header>
          <Card.Body className="p-0">
            <Table striped responsive className="mb-0">
              <thead>
                <tr>
                  <th>Statistic</th>
                  <th className="text-end">All selected</th>
                  {result.byCourse.length > 1 && result.byCourse.map((c) => (
                    <th key={c.courseId} className="text-end">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m, i) => (
                  <React.Fragment key={m.label}>
                    {i === 0 || METRICS[i - 1].group !== m.group ? (
                      <tr>
                        <td colSpan={2 + (result.byCourse.length > 1 ? result.byCourse.length : 0)}
                          className="small text-uppercase text-muted fw-semibold pt-3">
                          {m.group}
                        </td>
                      </tr>
                    ) : null}
                    <tr>
                      <td>
                        <div>{m.label}</div>
                        {m.help ? <div className="small text-muted">{m.help}</div> : null}
                      </td>
                      <td className="text-end fw-semibold">{show(m.get(result.overall))}</td>
                      {result.byCourse.length > 1 && result.byCourse.map((c) => (
                        <td key={c.courseId} className="text-end">{show(m.get(c.stats))}</td>
                      ))}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </Table>
          </Card.Body>
          <Card.Footer className="small text-muted">
            Revisions and AI decisions include both written and code answers.
            Participation uses who clicked Submit for the group.
          </Card.Footer>
        </Card>
      ) : null}
    </Container>
  );
}
