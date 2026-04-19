// client/src/pages/ManageCourseTestsPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Container, Spinner, Alert } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

export default function ManageCourseTestsPage() {
  const { courseId } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();

  const [tests, setTests] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setLoading(true);
        setError('');

        const res = await fetch(
          `${API_BASE_URL}/api/courses/${courseId}/test-results`,
          { credentials: 'include' }
        );

        if (!res.ok) {
          throw new Error(`Failed to load test results (status ${res.status})`);
        }

        const data = await res.json();
        if (!isMounted) return;

        const { tests: rawTests = [], students: rawStudents = [] } = data;

        // Enrich students with completed/partial counts (optional but handy)
        const enrichedStudents = rawStudents.map((s) => {
          let completed = 0;
          let partial = 0;

          for (const t of rawTests) {
            const score = s.scores?.[t.id];
            if (!score) continue;

            if (score.status === 'completed' && score.pointsPossible > 0) {
              completed += 1;
            } else if (score.status === 'in_progress') {
              partial += 1;
            }
          }

          return {
            ...s,
            completedTests: completed,
            partialTests: partial,
          };
        });

        setTests(rawTests);
        setStudents(enrichedStudents);
      } catch (err) {
        console.error('❌ Failed to load course test results:', err);
        if (isMounted) setError(err.message || 'Failed to load test results');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [courseId]);

  const renderScoreCell = (student, test) => {
    const score = student.scores?.[test.id];

    if (!score || score.pointsPossible == null || score.pointsPossible <= 0) {
      // No score yet / not graded
      return (
        <td key={test.id} style={{ textAlign: 'center', fontSize: '0.9rem' }}>
          —
        </td>
      );
    }

    const { pointsEarned = 0, pointsPossible = 0, status } = score;
    const pct =
      pointsPossible > 0
        ? Math.round((pointsEarned / pointsPossible) * 100)
        : 0;

    let color = 'inherit';
    if (status === 'completed') {
      // Simple color coding by percent
      if (pct >= 90) color = 'green';
      else if (pct >= 70) color = 'orange';
      else color = 'crimson';
    }

    return (
      <td key={test.id} style={{ textAlign: 'center', fontSize: '0.9rem' }}>
        <div style={{ fontWeight: 'bold', color }}>
          {pointsEarned}/{pointsPossible}
        </div>
        <div style={{ color }}>{pct}%</div>
      </td>
    );
  };

  if (loading) {
    return (
      <Container className="mt-4 text-center">
        <Spinner animation="border" role="status" />
        <div className="mt-2">Loading test results...</div>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <h3>Test Results</h3>

      {error && (
        <Alert variant="danger" className="mt-3">
          {error}
        </Alert>
      )}

      {tests.length === 0 ? (
        <p className="mt-3">No tests found for this course.</p>
      ) : (
        <Table bordered className="mt-3">
          <thead>
            <tr>
              <th>Name</th>
              <th>Completed</th>
              <th>Partial</th>
              {tests.map((t) => (
                <th key={t.id}>{t.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.completedTests}</td>
                <td>{s.partialTests}</td>
                {tests.map((t) => renderScoreCell(s, t))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="mt-3">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    </Container>
  );
}
