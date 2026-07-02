import React from 'react';
import { Badge, Card, Col, Container, Row } from 'react-bootstrap';

const featureCards = [
  {
    title: 'Student collaboration',
    tone: 'primary',
    body: 'Students work together in a shared activity space, see one another’s progress, and build answers through conversation instead of isolation.',
    bullets: [
      'Shared group response flow',
      'Visible revisions and turn-taking',
      'Supports peer explanation and sensemaking',
    ],
  },
  {
    title: 'AI-guided activity development',
    tone: 'success',
    body: 'Instructors draft and refine activities with AI assistance, then move straight into testing, revision, and classroom-ready demonstration.',
    bullets: [
      'AI-assisted activity creation',
      'Fast edit / preview / revise loop',
      'Keeps instructors in control of the pedagogy',
    ],
  },
  {
    title: 'Instructor dashboard',
    tone: 'info',
    body: 'The instructor view shows the live class, activity list, and overall flow so it is easy to monitor what is happening in the room.',
    bullets: [
      'Activity list and class overview',
      'Visible status and progress tracking',
      'Designed for in-room teaching and support',
    ],
  },
  {
    title: 'Live monitoring and trace',
    tone: 'warning',
    body: 'The epistemic trace makes reasoning, revision, and participation visible over time so the learning process can be observed and discussed.',
    bullets: [
      'See answers, feedback, and revisions',
      'Track how understanding evolves',
      'Useful for demoing, coaching, and reflection',
    ],
  },
];

const pillars = [
  'A collaborative learning flow that keeps students working together.',
  'AI support that nudges progress without taking over the thinking.',
  'Instructor tools for setup, monitoring, and live classroom management.',
  'A visible epistemic trace that surfaces reasoning and revision.',
];

const flowSteps = [
  'Launch a student, instructor, or creator demo from the conference page.',
  'Watch the activity unfold live with group participation and guided prompts.',
  'Use the dashboard and monitoring views to follow progress in real time.',
  'Review the trace to see how ideas changed from first attempt to final answer.',
];

function FeatureCard({ title, tone, body, bullets }) {
  const toneStyles = {
    primary: {
      borderColor: '#b8d4ff',
      background: 'linear-gradient(180deg, rgba(226,240,255,0.95) 0%, rgba(255,255,255,0.98) 100%)',
    },
    success: {
      borderColor: '#bde6cc',
      background: 'linear-gradient(180deg, rgba(231,248,236,0.96) 0%, rgba(255,255,255,0.98) 100%)',
    },
    info: {
      borderColor: '#bfe7ef',
      background: 'linear-gradient(180deg, rgba(231,247,250,0.96) 0%, rgba(255,255,255,0.98) 100%)',
    },
    warning: {
      borderColor: '#f1d29a',
      background: 'linear-gradient(180deg, rgba(255,247,229,0.97) 0%, rgba(255,255,255,0.98) 100%)',
    },
  };

  const style = toneStyles[tone] || toneStyles.primary;

  return (
    <Card className="h-100 shadow-sm border-0" style={{ borderRadius: '18px', overflow: 'hidden', borderTop: `4px solid ${style.borderColor}`, background: style.background }}>
      <Card.Body className="p-4">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <h2 className="h5 fw-bold mb-0">{title}</h2>
          <Badge bg={tone} className="text-uppercase">
            Overview
          </Badge>
        </div>
        <p className="text-secondary mb-3" style={{ lineHeight: 1.55 }}>
          {body}
        </p>
        <ul className="mb-0 ps-3">
          {bullets.map((bullet) => (
            <li key={bullet} className="mb-2">
              {bullet}
            </li>
          ))}
        </ul>
      </Card.Body>
    </Card>
  );
}

export default function InfoPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f6f8fb 0%, #ffffff 35%, #eef6ef 100%)',
        paddingTop: '4.5rem',
        paddingBottom: '1.25rem',
      }}
    >
      <Container fluid className="px-3 px-xxl-4">
        <Row className="g-3 align-items-stretch mb-3">
          <Col xl={4}>
            <div
              className="h-100 p-4 rounded-4 shadow-sm border-0"
              style={{
                background: 'linear-gradient(160deg, #123524 0%, #1f5b3b 58%, #d89a38 100%)',
                color: '#fff',
              }}
            >
              <div className="text-uppercase fw-semibold text-white-50 mb-2" style={{ letterSpacing: '0.08em' }}>
                AIED2026 Info
              </div>
              <h1 className="display-5 fw-bold mb-3" style={{ lineHeight: 0.98 }}>
                coLearn-AI at a glance
              </h1>
              <p className="lead mb-3" style={{ maxWidth: '34rem', opacity: 0.9 }}>
                A collaborative learning platform that combines student teamwork, AI-guided activity development,
                instructor monitoring, and a visible epistemic trace.
              </p>

              <div className="d-flex flex-wrap gap-2 mb-3">
                <Badge bg="light" text="dark" className="px-3 py-2 rounded-pill">
                  Student collaboration
                </Badge>
                <Badge bg="light" text="dark" className="px-3 py-2 rounded-pill">
                  AI-assisted creation
                </Badge>
                <Badge bg="light" text="dark" className="px-3 py-2 rounded-pill">
                  Live monitoring
                </Badge>
                <Badge bg="light" text="dark" className="px-3 py-2 rounded-pill">
                  Epistemic trace
                </Badge>
              </div>

              <div className="p-3 rounded-4" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <div className="fw-semibold mb-2">What you can expect</div>
                <ul className="mb-0 ps-3">
                  {pillars.map((pill) => (
                    <li key={pill} className="mb-2">
                      {pill}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Col>

          <Col xl={4}>
            <div
              className="h-100 p-3 rounded-4 border shadow-sm bg-white"
              style={{ borderColor: '#dfe5ee' }}
            >
              <div className="text-uppercase fw-semibold text-secondary mb-2" style={{ letterSpacing: '0.08em' }}>
                The flow
              </div>
              <h2 className="h4 fw-bold mb-3">How the system comes together</h2>
              <div className="d-grid gap-2">
                {flowSteps.map((step, index) => (
                  <div
                    key={step}
                    className="d-flex gap-3 align-items-start p-2 rounded-3"
                    style={{ background: index % 2 === 0 ? '#f7fafc' : '#f1f8f3' }}
                  >
                    <div
                      className="flex-shrink-0 d-flex align-items-center justify-content-center rounded-circle fw-bold"
                      style={{
                        width: 30,
                        height: 30,
                        background: index === 0 ? '#1d6fff' : index === 1 ? '#1f9d66' : index === 2 ? '#0ea5c6' : '#d97706',
                        color: '#fff',
                        fontSize: '0.9rem',
                      }}
                    >
                      {index + 1}
                    </div>
                    <div className="text-secondary small" style={{ lineHeight: 1.45 }}>
                      {step}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Col>

          <Col xl={4}>
            <div
              className="h-100 p-3 rounded-4 border shadow-sm"
              style={{
                borderColor: '#b9d5be',
                background: 'linear-gradient(180deg, #ffffff 0%, #f7fbf7 100%)',
              }}
            >
              <div className="text-uppercase fw-semibold text-secondary mb-2" style={{ letterSpacing: '0.08em' }}>
                Why it matters
              </div>
              <h2 className="h4 fw-bold mb-2">Built for classroom visibility</h2>
              <ul className="ps-3 mb-3">
                <li className="mb-2">Students can work together while the system keeps the activity visible and structured.</li>
                <li className="mb-2">AI helps instructors create and refine activities without taking over their judgment.</li>
                <li className="mb-2">The dashboard and live monitoring views help instructors support a room in motion.</li>
                <li className="mb-2">The epistemic trace keeps the reasoning trail visible for reflection and discussion.</li>
              </ul>

              <div className="p-3 rounded-4" style={{ background: '#123524', color: '#fff' }}>
                <div className="fw-semibold mb-2">Conference snapshot</div>
                <div className="small" style={{ lineHeight: 1.55 }}>
                  Use this page as the high-level overview, then move into the student demo, instructor demo, or creator demo
                  depending on the audience and time available.
                </div>
              </div>
            </div>
          </Col>
        </Row>

        <Row className="g-3">
          {featureCards.map((card) => (
            <Col key={card.title} lg={6} xl={3}>
              <FeatureCard {...card} />
            </Col>
          ))}
        </Row>
      </Container>
    </div>
  );
}
