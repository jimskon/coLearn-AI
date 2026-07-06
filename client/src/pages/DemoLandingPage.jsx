import React from 'react';
import { Button, Card, Col, Container, Form, Modal, Row } from 'react-bootstrap';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
    variant: 'custom-instructor',
    description: 'Preview how instructors see the activity list and student-management screens.',
  },
  {
    key: 'creator',
    label: 'Try Creator Demo',
    variant: 'success',
    description: 'Build an activity with AI support, then test and refine it in the same flow.',
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

function normalizeEntryMode(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (value === 'solo' || value === 'group') return value;
  return '';
}

export default function DemoLandingPage({ defaultDemoCode = '', autoStartStudent = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { demoCode: routeDemoCode = '' } = useParams();
  const demoCode = routeDemoCode || defaultDemoCode;
  const { setUser } = useUser();
  const autoStartOnceRef = React.useRef(false);
  const [studentBusy, setStudentBusy] = React.useState(false);
  const [studentError, setStudentError] = React.useState('');
  const [guestName, setGuestName] = React.useState('');
  const [showInfoRequestModal, setShowInfoRequestModal] = React.useState(false);
  const [joinPrompt, setJoinPrompt] = React.useState({
    show: false,
    session: null,
    course: null,
    studentId: null,
  });
  const [joinChoiceBusy, setJoinChoiceBusy] = React.useState(false);

  const entryMode = normalizeEntryMode(new URLSearchParams(location.search).get('entry'));

  const startStudentDemo = async () => {
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
      return data;
    } catch (err) {
      setStudentError(err?.message || 'Failed to start student demo');
      return null;
    } finally {
      setStudentBusy(false);
      setJoinChoiceBusy(false);
    }
  };

  const joinActiveGroup = async ({ studentId, joinSession, courseName }) => {
    if (!studentId || !joinSession?.activityId || !joinSession?.courseId) return false;

    const joinRes = await fetch(
      `${API_BASE_URL}/api/groups/${joinSession.activityId}/${joinSession.courseId}/smart-add`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ studentId }),
      }
    );

    const joinData = await joinRes.json().catch(() => ({}));
    if (!joinRes.ok || !joinData?.activityInstanceId) {
      console.warn('Could not join the active demo group, falling back to the solo path.', joinData);
      return false;
    }

    navigate(`/run/${joinData.activityInstanceId}`, {
      state: { courseName },
    });
    return true;
  };

  const navigateToCourseActivities = (course) => {
    if (!course?.id) return;
    navigate(`/courses/${course.id}/activities`, {
      state: { courseName: course.name },
    });
  };

  const handleStudentDemo = async () => {
    const data = await startStudentDemo();
    if (!data) return;

    if (entryMode === 'solo') {
      navigateToCourseActivities(data.course);
      return;
    }

    if (entryMode === 'group' && data.joinableSession) {
      const joined = await joinActiveGroup({
        studentId: data.user.id,
        joinSession: data.joinableSession,
        courseName: data.course.name,
      });
      if (!joined) {
        navigateToCourseActivities(data.course);
      }
      return;
    }

    if (data.joinableSession && Number(data.joinableSession.activeMembers) > 1) {
      setJoinPrompt({
        show: true,
        session: data.joinableSession,
        course: data.course,
        studentId: data.user.id,
      });
      return;
    }

    navigateToCourseActivities(data.course);
  };

  const handleJoinSolo = async () => {
    const course = joinPrompt.course;
    setJoinPrompt({ show: false, session: null, course: null, studentId: null });
    navigateToCourseActivities(course);
  };

  const handleJoinCancel = () => {
    setJoinPrompt({ show: false, session: null, course: null, studentId: null });
  };

  const handleJoinGroup = async () => {
    if (!joinPrompt.session || !joinPrompt.studentId) return;
    const session = joinPrompt.session;
    const course = joinPrompt.course;
    const studentId = joinPrompt.studentId;
    setJoinChoiceBusy(true);
    setJoinPrompt({ show: false, session: null, course: null, studentId: null });
    try {
      const joined = await joinActiveGroup({
        studentId,
        joinSession: session,
        courseName: course?.name,
      });
      if (!joined) {
        navigateToCourseActivities(course);
      }
    } catch (err) {
      console.warn('Joining the live demo session failed; continuing to the solo path.', err);
      navigateToCourseActivities(course);
    } finally {
      setJoinChoiceBusy(false);
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

  React.useEffect(() => {
    if (!autoStartStudent || autoStartOnceRef.current) return;
    autoStartOnceRef.current = true;
    handleStudentDemo();
  }, [autoStartStudent, handleStudentDemo]);

  if (autoStartStudent) {
    return (
      <>
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
              <Col lg={10} xl={8}>
                <Card className="shadow-lg border-0" style={{ borderRadius: '18px' }}>
                  <Card.Body className="p-5">
                    <div className="text-uppercase fw-semibold text-secondary mb-2" style={{ letterSpacing: '0.08em' }}>
                      Demo code
                    </div>
                    <h1 className="h2 fw-bold mb-3">Starting the student demo</h1>
                    <p className="text-secondary mb-0">
                      We’re opening the learner experience for this demo code now.
                    </p>
                    {studentError ? (
                      <div className="text-danger mt-4">{studentError}</div>
                    ) : null}
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </Container>
        </div>

        <DemoInfoRequestModal
          show={showInfoRequestModal}
          demoCode={demoCode}
          onHide={() => setShowInfoRequestModal(false)}
        />
        <Modal
          show={joinPrompt.show}
          centered
          backdrop="static"
          keyboard={false}
          onHide={() => setJoinPrompt({ show: false, session: null, course: null, studentId: null })}
        >
          <Modal.Header>
            <Modal.Title>How are you joining?</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="mb-3">
              There is already a live demo session running.
              {' '}
              Group mode is recommended only if you are joining the people already in the room.
            </p>
            <div className="p-3 rounded-3 border bg-light">
              <div className="fw-semibold mb-1">
                {joinPrompt.session?.activityTitle || 'Live demo session'}
              </div>
              <div className="text-secondary small">
                {joinPrompt.session?.activeMembers
                  ? `${joinPrompt.session.activeMembers} active participant${joinPrompt.session.activeMembers === 1 ? '' : 's'} ${joinPrompt.session.activeMembers === 1 ? 'is' : 'are'} already connected.`
                  : 'Someone is already active in this demo.'}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="outline-secondary"
              onClick={handleJoinCancel}
              disabled={joinChoiceBusy || studentBusy}
            >
              Cancel
            </Button>
            <Button
              variant="outline-secondary"
              onClick={handleJoinSolo}
              disabled={joinChoiceBusy || studentBusy}
            >
              Work solo
            </Button>
            <Button
              variant="primary"
              onClick={handleJoinGroup}
              disabled={joinChoiceBusy || studentBusy}
            >
              Join group
            </Button>
          </Modal.Footer>
        </Modal>
      </>
    );
  }

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
                            variant={option.variant === 'custom-instructor' ? 'primary' : option.variant}
                            size="lg"
                            className={`text-start py-3 px-4 ${option.variant === 'custom-instructor' ? 'text-white border-0' : ''}`}
                            style={option.variant === 'custom-instructor'
                              ? { background: 'linear-gradient(135deg, #1f6f78 0%, #2f8f9b 100%)' }
                              : undefined}
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
      <Modal
        show={joinPrompt.show}
        centered
        backdrop="static"
        keyboard={false}
        onHide={() => setJoinPrompt({ show: false, session: null, course: null, studentId: null })}
      >
        <Modal.Header>
          <Modal.Title>How are you joining?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-3">
            There is already a live demo session running.
            {' '}
            Group mode is recommended only if you are joining the people already in the room.
          </p>
          <div className="p-3 rounded-3 border bg-light">
            <div className="fw-semibold mb-1">
              {joinPrompt.session?.activityTitle || 'Live demo session'}
            </div>
            <div className="text-secondary small">
              {joinPrompt.session?.activeMembers
                ? `${joinPrompt.session.activeMembers} active participant${joinPrompt.session.activeMembers === 1 ? '' : 's'} ${joinPrompt.session.activeMembers === 1 ? 'is' : 'are'} already connected.`
                : 'Someone is already active in this demo.'}
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            onClick={handleJoinCancel}
            disabled={joinChoiceBusy || studentBusy}
          >
            Cancel
          </Button>
          <Button
            variant="outline-secondary"
            onClick={handleJoinSolo}
            disabled={joinChoiceBusy || studentBusy}
          >
            Work solo
          </Button>
          <Button
            variant="primary"
            onClick={handleJoinGroup}
            disabled={joinChoiceBusy || studentBusy}
          >
            Join group
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
