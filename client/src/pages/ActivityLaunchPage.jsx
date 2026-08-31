import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Container, Spinner } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

// A public launch URL contains only course/activity IDs. The server, not this
// page, verifies enrollment and chooses the student's own activity instance.
export default function ActivityLaunchPage() {
  const { courseId, activityId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const returnTo = `${location.pathname}${location.search}`;

    const resolveLaunch = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/courses/${encodeURIComponent(courseId)}/activities/${encodeURIComponent(activityId)}/launch`,
          { credentials: 'include' },
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          navigate(`/?next=${encodeURIComponent(returnTo)}`, { replace: true });
          return;
        }
        if (!res.ok || !data?.destination) {
          throw new Error(data?.error || 'This activity could not be opened.');
        }
        // The destination is supplied by our server and is intentionally an
        // internal client route, never a URL supplied by WordPress or Moodle.
        if (!String(data.destination).startsWith('/') || String(data.destination).startsWith('//')) {
          throw new Error('The activity returned an invalid destination.');
        }
        navigate(data.destination, { replace: true });
      } catch (err) {
        if (!cancelled) setError(err?.message || 'This activity could not be opened.');
      }
    };

    resolveLaunch();
    return () => { cancelled = true; };
  }, [activityId, courseId, location.pathname, location.search, navigate]);

  return (
    <Container className="mt-5" style={{ maxWidth: 680 }}>
      {error ? (
        <Alert variant="danger">
          <Alert.Heading>Unable to open activity</Alert.Heading>
          <p className="mb-2">{error}</p>
          <Link to="/dashboard">Go to Dashboard</Link>
        </Alert>
      ) : (
        <div className="d-flex align-items-center gap-2">
          <Spinner animation="border" size="sm" />
          <span>Opening your activity…</span>
        </div>
      )}
    </Container>
  );
}
