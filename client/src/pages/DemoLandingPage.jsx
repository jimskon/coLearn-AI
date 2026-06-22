import React from 'react';
import { Button, Card, Col, Container, Form, Row } from 'react-bootstrap';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';
import DemoInfoRequestModal from '../components/demo/DemoInfoRequestModal';

const demoOptions = [
  {
    key: 'student',
    label: 'Try Student Demo',
    variant: 'primary',
    description: 'Step into a collaborative learner experience with guided prompts and shared sensemaking.',
  },
  {
    key: 'instructor',
    label: 'Try Instructor Demo',
    variant: 'outline-dark',
    description: 'Preview how instructors see the activity list and student-management screens.',
  },
  {
    key: 'creator',
    label: 'Try Creator Demo',
    variant: 'success',
    description: 'Preview how instructors can set up, test, and demonstrate activities with low friction.',
  },
  {
    key: 'info-request',
    label: 'Request More Information',
    variant: 'outline-secondary',
    description: 'Get updates, request beta access, discuss a pilot, or ask about research collaboration.',
  },
];

const valueProps = [
  'Collaboration that keeps learners working with one another instead of in isolation.',
  'AI scaffolding that supports progress without taking over the thinking.',
  'Activity flow designed to manage cognitive load and keep attention on learning.',
  'An epistemic trace that makes reasoning, revision, and participation visible.',
  'Easy instructor demonstration for modeling an activity before class use.',
];

export default function DemoLandingPage({ defaultDemoCode = '' }) {
  const navigate = useNavigate();
  const { demoCode: routeDemoCode = '' } = useParams();
  const demoCode = routeDemoCode || defaultDemoCode;
  const { setUser } = useUser();
  const [studentBusy, setStudentBusy] = React.useState(false);
  const [studentError, setStudentError] = React.useState('');
  const [guestName, setGuestName] = React.useState('');
  const [showInfoRequestModal, setShowInfoRequestModal] = React.useState(false);

  const handleStudentDemo = async () => {
    setStudentBusy(true);
    setStudentError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/demo/student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ demoCode, guestName }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.user || !data?.course?.id) {
        throw new Error(data?.error || 'Failed to start student demo');
      }

      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      navigate(`/courses/${data.course.id}/activities`, {
        state: { courseName: data.course.name },
      });
    } catch (err) {
      setStudentError(err?.message || 'Failed to start student demo');
    } finally {
      setStudentBusy(false);
    }
  };

  const handleCreatorDemo = () => {
    navigate(`/demo/${encodeURIComponent(demoCode)}/creator`, {
      state: { guestName },
    });
  };

  const handleInstructorDemo = () => {
    navigate(`/demo/${encodeURIComponent(demoCode)}/instructor`, {
      state: { guestName },
    });
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f4efe4 0%, #ffffff 45%, #e7f1ea 100%)',
        paddingTop: '6rem',
        paddingBottom: '3rem',
      }}
      >
      <Container>
        <Row className="justify-content-center">
          <Col lg={11} xl={11}>
            <Card
              className="shadow-lg border-0"
              style={{
                overflow: 'hidden',
                borderRadius: '18px',
                background: 'rgba(255, 255, 255, 0.94)',
              }}
            >
              <Card.Body className="p-4 p-md-5">
                <Row className="g-4 align-items-stretch">
                  <Col lg={4} xl={4}>
                    <div className="h-100 p-4 border rounded-4 bg-white">
                      <div className="text-uppercase fw-semibold text-secondary mb-2" style={{ letterSpacing: '0.08em' }}>
                        AIED2026 Demo
                      </div>
                      <h1 className="h2 fw-bold mb-3" style={{ lineHeight: 1.08 }}>
                        Explore collaborative learning with coLearn-AI
                      </h1>
                      <p className="text-secondary mb-3">
                        This public demo introduces a platform built for live collaboration, AI scaffolding,
                        visible reasoning, and smooth instructor-led demonstration.
                      </p>
                      <div className="d-inline-flex align-items-center px-3 py-2 rounded-pill bg-light border mb-4">
                        <span className="fw-semibold me-2">Demo code</span>
                        <code>{demoCode}</code>
                      </div>

                      <Form.Group controlId="demoGuestName">
                        <Form.Label className="fw-semibold">Your name (optional)</Form.Label>
                        <Form.Control
                          type="text"
                          size="lg"
                          placeholder="Enter the name you want others to see"
                          value={guestName}
                          onChange={(event) => setGuestName(event.target.value)}
                          maxLength={80}
                          autoComplete="nickname"
                        />
                        <Form.Text className="text-muted">
                          Leave it blank and we&apos;ll assign a simple guest number.
                        </Form.Text>
                      </Form.Group>
                    </div>
                  </Col>

                  <Col lg={4} xl={4}>
                    <div className="h-100 p-4 border rounded-4 bg-white">
                      <div className="text-uppercase fw-semibold text-secondary mb-2" style={{ letterSpacing: '0.08em' }}>
                        Activities
                      </div>
                      <h2 className="h4 fw-bold mb-3">Choose a demo path</h2>
                      <div className="d-grid gap-3">
                        {demoOptions.map((option) => (
                          <Button
                            key={option.key}
                            variant={option.variant}
                            size="lg"
                            className="text-start py-3 px-4"
                            onClick={() => (
                              option.key === 'student'
                                ? handleStudentDemo()
                                : option.key === 'creator'
                                  ? handleCreatorDemo()
                                  : option.key === 'instructor'
                                    ? handleInstructorDemo()
                                    : setShowInfoRequestModal(true)
                            )}
                            disabled={studentBusy}
                          >
                            <div className="fw-semibold">
                              {studentBusy && option.key === 'student'
                                ? 'Starting Student Demo...'
                                : studentBusy && option.key === 'creator'
                                  ? 'Starting Creator Demo...'
                                  : option.label}
                            </div>
                            <div className="small opacity-75 mt-1">{option.description}</div>
                          </Button>
                        ))}
                      </div>
                      {studentError ? <div className="text-danger mt-3">{studentError}</div> : null}
                    </div>
                  </Col>

                  <Col lg={4} xl={4}>
                    <div
                      className="h-100 p-4 border rounded-4"
                      style={{
                        background: 'linear-gradient(160deg, #123524 0%, #1f5b3b 55%, #d89a38 100%)',
                        color: '#fff',
                      }}
                    >
                      <h2 className="h4 fw-bold mb-3">Why this platform feels different</h2>
                      <div className="small text-white-50 mb-3">
                        Designed for classrooms where learning is social, guided, and visible.
                      </div>
                      <ul className="mb-0 ps-3">
                        {valueProps.map((item) => (
                          <li key={item} className="mb-3">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
      <DemoInfoRequestModal
        show={showInfoRequestModal}
        demoCode={demoCode}
        onHide={() => setShowInfoRequestModal(false)}
      />
    </div>
  );
}
