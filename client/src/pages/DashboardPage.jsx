import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { Table, Button, Form, Container, Alert, Row, Col, Spinner } from 'react-bootstrap';

export default function DashboardPage() {
  const { user } = useUser();
  const navigate = useNavigate();

  const [enrolledCourses, setEnrolledCourses] = useState([]);
  const [courseCode, setCourseCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;

    const fetchEnrollments = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/courses/user/${user.id}/enrollments`);
        const data = await res.json();
        setEnrolledCourses(data);
      } catch (err) {
        console.error('Failed to fetch enrollments', err);
        setError('Unable to load joined instances');
      } finally {
        setLoading(false);
      }
    };

    fetchEnrollments();
  }, [user?.id]);

  const handleJoinCourse = async () => {
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/courses/enroll-by-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, code: courseCode })
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess('Successfully joined!');
        setCourseCode('');
        setEnrolledCourses(prev => [...prev, data.newCourse]);
      } else {
        setError(data.error || 'Failed to join');
      }
    } catch (err) {
      console.error('Enrollment error:', err);
      setError('Failed to join instance');
    }
  };

  const canManage = user?.role === 'root' || user?.role === 'creator';

  const nonStudent = ['root', 'creator', 'instructor'].includes(user?.role);
  return (
    <Container className="mt-4">
      <h2>Welcome, {user?.name}</h2>

      {user?.id && (
        <>
          {loading ? (
            <Spinner animation="border" />
          ) : enrolledCourses.length > 0 ? (
            <>
              <h4>{nonStudent ? 'Your Managed Instances' : 'Your Joined Instances'}</h4>
              <Table striped bordered hover>
                <thead>
                  <tr>
                    <th>Instance Name</th>
                    <th>Join Code</th>
                    <th>Section</th>
                    <th>Semester</th>
                    <th>Year</th>
                    <th>Instructor</th>
                  </tr>
                </thead>
                <tbody>
                  {enrolledCourses.map(course => (
                    <tr key={course.id}>
                      <td
                        style={{ cursor: 'pointer', textDecoration: 'underline', color: 'blue' }}
                        onClick={() => navigate(`/courses/${course.id}/activities`, {
                          state: { courseName: course.name }  // ✅ pass courseName to next page
                        })}
                      >
                        {course.name}
                      </td>

                      <td>{course.code}</td>
                      <td>{course.section}</td>
                      <td>{course.semester}</td>
                      <td>{course.year}</td>
                      <td>{course.instructor_name || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : (
            <p>You have not joined any instances yet.</p>
          )}

          <h5 className="mt-5">Join an Instance</h5>
          <Form className="d-flex" onSubmit={(e) => { e.preventDefault(); handleJoinCourse(); }}>
            <Form.Control
              type="text"
              placeholder="Enter join code"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
            />
            <Button className="ms-2" variant="primary" onClick={handleJoinCourse}>
              Join
            </Button>
          </Form>

          {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
          {success && <Alert variant="success" className="mt-3">{success}</Alert>}
        </>
      )}
    </Container>
  );
}
