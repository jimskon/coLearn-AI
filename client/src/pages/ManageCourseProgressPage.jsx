// ManagageCourseProgessPage
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Container } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';
import { CheckCircleFill } from 'react-bootstrap-icons';

const statusColor = {
  completed: 'green',
  in_progress: 'orange',
  not_started: 'lightgray'
};

export default function ManageCourseProgressPage() {
  const { courseId } = useParams();
  const { user } = useUser();
  const [students, setStudents] = useState([]);
  const [activities, setActivities] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/courses/${courseId}/progress`)
      .then(res => res.json())
      .then(data => {
        setStudents(data.students || []);
        setActivities(data.activities || []);
      })
      .catch(err => console.error('Failed to load progress:', err));
  }, [courseId]);

  const renderActivityCell = (student, activity) => {
    const progress = student.progress?.[activity.id];

    // No record or explicitly not started
    if (!progress || progress.status === 'not_started') {
      return <td key={activity.id} style={{ textAlign: 'center' }}>—</td>;
    }

    const {
      status,
      completedGroups,
      totalGroups,
      isTest,
      pointsEarned,
      pointsPossible
    } = progress;

    // TEST: show points and percentage if we have them
    if (isTest && pointsEarned != null && pointsPossible) {
      const pct = Math.round((pointsEarned / pointsPossible) * 100);

      return (
        <td key={activity.id} style={{ textAlign: 'center', fontSize: '0.9rem' }}>
          <div>
            {pointsEarned}/{pointsPossible}
          </div>
          <div>{pct}%</div>
          {status === 'completed' && (
            <div>
              <CheckCircleFill color={statusColor.completed} />
            </div>
          )}
        </td>
      );
    }

    // NON-TEST (or test with no scores yet)

    // Completed: green check only (your existing behavior)
    if (status === 'completed') {
      return (
        <td key={activity.id} style={{ textAlign: 'center' }}>
          <CheckCircleFill color={statusColor.completed} />
        </td>
      );
    }

    // In progress: show x/y groups if we know them
    if (status === 'in_progress' && totalGroups) {
      const x = completedGroups || 0;
      const y = totalGroups;
      return (
        <td key={activity.id} style={{ textAlign: 'center' }}>
          {x}/{y}
        </td>
      );
    }

    // Fallback
    return (
      <td key={activity.id} style={{ textAlign: 'center' }}>
        —
      </td>
    );
  };

  return (
    <Container className="mt-4">
      <h3>Student Progress</h3>
      <Table bordered>
        <thead>
          <tr>
            <th>Name</th>
            <th>Complete</th>
            <th>Partial</th>
            {activities.map(a => (
              <th key={a.id}>{a.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map(s => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.completeCount}</td>
              <td>{s.partialCount}</td>
              {activities.map(a => renderActivityCell(s, a))}
            </tr>
          ))}
        </tbody>
      </Table>
      <Button onClick={() => navigate(-1)}>Back</Button>
    </Container>
  );
}
