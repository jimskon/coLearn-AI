import { Button, Card, Col, Container, Row } from 'react-bootstrap';
import { useNavigate, useParams } from 'react-router-dom';

const demoOptions = [
  {
    key: 'student',
    label: 'Try Student Demo',
    variant: 'primary',
    description: 'Step into a collaborative learner experience with guided prompts and shared sensemaking.',
  },
  {
    key: 'creator',
    label: 'Try Creator Demo',
    variant: 'success',
    description: 'Preview how instructors can set up, test, and demonstrate activities with low friction.',
  },
  {
    key: 'beta-access',
    label: 'Request Beta Access',
    variant: 'outline-dark',
    description: 'Leave this demo flow and tell us you want a deeper pilot or early access conversation.',
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

  const openDemoPath = (pathKey) => {
    navigate(`/demo/${encodeURIComponent(demoCode)}/${pathKey}`);
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
          <Col lg={10} xl={9}>
            <Card
              className="shadow-lg border-0"
              style={{
                overflow: 'hidden',
                borderRadius: '18px',
                background: 'rgba(255, 255, 255, 0.94)',
              }}
            >
              <Card.Body className="p-4 p-md-5">
                <Row className="g-4 align-items-start">
                  <Col lg={7}>
                    <div className="text-uppercase fw-semibold text-secondary mb-2" style={{ letterSpacing: '0.08em' }}>
                      AIED2026 Demo
                    </div>
                    <h1 className="display-5 fw-bold mb-3" style={{ lineHeight: 1.08 }}>
                      Explore collaborative learning with coLearn-AI
                    </h1>
                    <p className="lead text-secondary mb-3">
                      This public demo introduces a platform built for live collaboration, AI scaffolding,
                      visible reasoning, and smooth instructor-led demonstration.
                    </p>
                    <div className="d-inline-flex align-items-center px-3 py-2 rounded-pill bg-light border mb-4">
                      <span className="fw-semibold me-2">Demo code</span>
                      <code>{demoCode}</code>
                    </div>

                    <div className="d-grid gap-3">
                      {demoOptions.map((option) => (
                        <Button
                          key={option.key}
                          variant={option.variant}
                          size="lg"
                          className="text-start py-3 px-4"
                          onClick={() => openDemoPath(option.key)}
                        >
                          <div className="fw-semibold">{option.label}</div>
                          <div className="small opacity-75 mt-1">{option.description}</div>
                        </Button>
                      ))}
                    </div>
                  </Col>

                  <Col lg={5}>
                    <div
                      className="h-100 p-4"
                      style={{
                        borderRadius: '16px',
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
    </div>
  );
}
