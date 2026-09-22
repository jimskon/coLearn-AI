// client/src/pages/ManageCourseHWPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Container, Spinner, Alert } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

export default function ManageCourseHWPage() {
  const { courseId } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();

  const [activities, setActivities] = useState([]);
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
          `${API_BASE_URL}/api/courses/${courseId}/hw-results`,
          { credentials: 'include' }
        );

        if (!res.ok) {
          throw new Error(`Failed to load HW results (status ${res.status})`);
        }

        const data = await res.json();
        if (!isMounted) return;

        const { activities: rawActivities = [], students: rawStudents = [] } = data;

        const enrichedStudents = rawStudents.map((s) => {
          let completed = 0;
          let partial = 0;

          for (const a of rawActivities) {
            const score = s.scores?.[a.id];
            if (!score) continue;

            if (score.status === 'completed' && score.pointsPossible > 0) {
              completed += 1;
            } else if (score.status === 'in_progress') {
              partial += 1;
            }
          }

          return { ...s, completedHW: completed, partialHW: partial };
        });

        setActivities(rawActivities);
        setStudents(enrichedStudents);
      } catch (err) {
        console.error('❌ Failed to load HW results:', err);
        if (isMounted) setError(err.message || 'Failed to load HW results');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();

    return () => { isMounted = false; };
  }, [courseId]);

  const renderScoreCell = (student, activity) => {
    const score = student.scores?.[activity.id];

    if (!score || score.pointsPossible == null || score.pointsPossible <= 0) {
      return (
        <td key={activity.id} style={{ textAlign: 'center', fontSize: '0.9rem' }}>
          —
        </td>
      );
    }

    const { pointsEarned = 0, pointsPossible = 0, status } = score;
    const pct = pointsPossible > 0 ? Math.round((pointsEarned / pointsPossible) * 100) : 0;

    let color = 'inherit';
    if (status === 'completed') {
      if (pct >= 90) color = 'green';
      else if (pct >= 70) color = 'orange';
      else color = 'crimson';
    }

    return (
      <td key={activity.id} style={{ textAlign: 'center', fontSize: '0.9rem' }}>
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
        <div className="mt-2">Loading HW results...</div>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <h3>HW / Lab Results</h3>

      {error && (
        <Alert variant="danger" className="mt-3">
          {error}
        </Alert>
      )}

      {activities.length === 0 ? (
        <p className="mt-3">No graded assignments found for this instance.</p>
      ) : (
        <Table bordered className="mt-3">
          <thead>
            <tr>
              <th>Name</th>
              <th>Completed</th>
              <th>Partial</th>
              {activities.map((a) => (
                <th key={a.id}>{a.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.completedHW}</td>
                <td>{s.partialHW}</td>
                {activities.map((a) => renderScoreCell(s, a))}
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
