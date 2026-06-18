import { Button, Card, Col, Container, Row } from 'react-bootstrap';
import { Link, useParams } from 'react-router-dom';

const pageCopy = {
  student: {
    title: 'Student Demo',
    body: 'This path will walk a visitor into the learner-side demo experience using the selected conference code.',
  },
  creator: {
    title: 'Creator Demo',
    body: 'This path will guide an instructor or designer into a creator-facing demo flow tied to the same event code.',
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
