import React, { useEffect, useState } from 'react';
import { Button, Card, Col, Container, Row, Spinner } from 'react-bootstrap';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

const pageCopy = {
  student: {
    title: 'Student Demo',
    body: 'This path will walk a visitor into the learner-side demo experience using the selected conference code.',
  },
  creator: {
    title: 'Creator Demo',
    body: 'Preparing the creator workbench for this demo code.',
  },
  'beta-access': {
    title: 'Request More Information',
    body: 'This path will collect follow-up interest from conference visitors after the demo.',
  },
};

export default function DemoPathPage({ defaultDemoCode = '' }) {
  const { demoCode: routeDemoCode = '', demoPath = '' } = useParams();
  const demoCode = routeDemoCode || defaultDemoCode;
  const copy = pageCopy[demoPath] || {
    title: 'Demo Path',
    body: 'This demo route is ready to receive the selected code and continue into the next step.',
  };
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useUser();
  const [busy, setBusy] = useState(demoPath === 'creator');
  const [error, setError] = useState('');

  useEffect(() => {
    if (demoPath !== 'creator') {
      setBusy(false);
      return undefined;
    }

    let cancelled = false;

    const startCreatorDemo = async () => {
      setBusy(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/demo/creator`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            demoCode,
            guestName: String(location.state?.guestName || ''),
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.user || !data?.class?.id) {
          throw new Error(data?.error || 'Failed to start creator demo');
        }

        if (cancelled) return;
        localStorage.setItem('user', JSON.stringify(data.user));
        setUser(data.user);
        navigate(`/class/${data.class.id}/create?demo=1`, {
          replace: true,
          state: { className: data.class.name, demoCode },
        });
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to start creator demo');
          setBusy(false);
        }
      }
    };

    startCreatorDemo();
    return () => {
      cancelled = true;
    };
  }, [demoCode, demoPath, location.state, navigate, setUser]);

  return (
    <Container className="py-5" style={{ marginTop: '4.5rem' }}>
      <Row className="justify-content-center">
        <Col md={10} lg={8}>
          <Card className="shadow-sm border-0">
            <Card.Body className="p-4 p-md-5">
              <div className="text-uppercase fw-semibold text-secondary mb-2" style={{ letterSpacing: '0.08em' }}>
                Demo Mode
              </div>
              <h1 className="display-6 fw-bold mb-3">{copy.title}</h1>
              <p className="lead text-secondary mb-4">{copy.body}</p>
              <p className="mb-4">
                The selected demo code is <code>{demoCode}</code>.
              </p>

              {demoPath === 'creator' ? (
                <div className="d-flex align-items-center gap-2 mb-4">
                  <Spinner animation="border" size="sm" />
                  <span>{busy ? 'Starting the creator workbench...' : 'Ready.'}</span>
                </div>
              ) : null}

              {error ? (
                <div className="alert alert-danger mb-4">{error}</div>
              ) : null}

              <div className="d-flex flex-wrap gap-3">
                <Button as={Link} to={`/demo/${encodeURIComponent(demoCode)}`} variant="primary">
                  Back to Demo Landing
                </Button>
                <Button as={Link} to="/" variant="outline-secondary">
                  Return to Login
                </Button>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
