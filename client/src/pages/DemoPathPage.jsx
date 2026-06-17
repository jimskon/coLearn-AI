import React from 'react';
import { Alert, Button, Card, Col, Container, Row, Spinner } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

const pageCopy = {
  student: {
    title: 'Student Demo',
    body: 'This path will walk a visitor into the learner-side demo experience using the selected conference code.',
  },
  creator: {
    title: 'Creator Demo',
    body: 'Opening the creator-facing demo and routing into the AI activity builder workbench for this event.',
  },
  'beta-access': {
    title: 'Beta Access',
    body: 'This path will collect interest from conference visitors who want deeper access after the demo.',
  },
};

function buildDemoLandingPath(routeDemoCode, defaultDemoCode) {
  if (routeDemoCode) {
    return `/demo/${encodeURIComponent(routeDemoCode)}`;
  }
  return `/${encodeURIComponent(defaultDemoCode)}`;
}

export default function DemoPathPage({ defaultDemoCode = '' }) {
  const navigate = useNavigate();
  const { setUser } = useUser();
  const { demoCode: routeDemoCode = '', demoPath = '' } = useParams();
  const demoCode = routeDemoCode || defaultDemoCode;
  const demoLandingPath = buildDemoLandingPath(routeDemoCode, defaultDemoCode);
  const copy = pageCopy[demoPath] || {
    title: 'Demo Path',
    body: 'This demo route is ready to receive the selected code and continue into the next step.',
  };
  const [launchState, setLaunchState] = React.useState({ busy: demoPath === 'creator', error: '' });

  React.useEffect(() => {
    if (demoPath !== 'creator') {
      setLaunchState({ busy: false, error: '' });
      return undefined;
    }

    let cancelled = false;

    const openCreatorWorkbench = (user, classId, courseName) => {
      if (cancelled) return;

      localStorage.setItem('user', JSON.stringify(user));
      setUser(user);
      navigate(`/class/${classId}/create`, {
        replace: true,
        state: {
          courseName,
          demoCode,
          demoMode: 'creator',
        },
      });
    };

    const openCreatorDemoFromExistingApis = async () => {
      const studentRes = await fetch(`${API_BASE_URL}/api/auth/demo/student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ demoCode }),
      });

      const studentData = await studentRes.json().catch(() => ({}));
      if (!studentRes.ok || !studentData?.user || !studentData?.course?.id) {
        throw new Error(studentData?.error || 'Failed to start creator demo');
      }

      const courseInfoRes = await fetch(`${API_BASE_URL}/api/courses/${studentData.course.id}/info`, {
        credentials: 'include',
      });
      const courseInfo = await courseInfoRes.json().catch(() => ({}));
      if (!courseInfoRes.ok || !courseInfo?.class_id) {
        throw new Error(courseInfo?.error || 'Failed to load creator demo class');
      }

      openCreatorWorkbench(
        { ...studentData.user, role: 'creator', demoCreatorFallback: true },
        courseInfo.class_id,
        studentData.course.name,
      );
    };

    const openCreatorDemo = async () => {
      setLaunchState({ busy: true, error: '' });
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/demo/creator`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ demoCode }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.user && data?.class?.id) {
          openCreatorWorkbench(data.user, data.class.id, data.course?.name);
          return;
        }

        const routeMissing = res.status === 404 && /route not found/i.test(String(data?.error || ''));
        if (!routeMissing) {
          throw new Error(data?.error || 'Failed to start creator demo');
        }

        await openCreatorDemoFromExistingApis();
      } catch (err) {
        if (!cancelled) {
          setLaunchState({ busy: false, error: err?.message || 'Failed to start creator demo' });
        }
      }
    };

    openCreatorDemo();

    return () => {
      cancelled = true;
    };
  }, [demoCode, demoPath, navigate, setUser]);

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

              {demoPath === 'creator' && launchState.busy ? (
                <div className="d-flex align-items-center gap-3 mb-4">
                  <Spinner animation="border" role="status" />
                  <div>Opening the AI activity builder…</div>
                </div>
              ) : null}

              {launchState.error ? (
                <Alert variant="danger">{launchState.error}</Alert>
              ) : null}

              <div className="d-flex flex-wrap gap-3">
                <Button as={Link} to={demoLandingPath} variant="primary">
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
