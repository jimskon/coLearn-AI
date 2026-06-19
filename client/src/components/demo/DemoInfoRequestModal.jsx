// src/components/demo/DemoInfoRequestModal.jsx
import React from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';
import { API_BASE_URL } from '../../config';
import { emptyInfoRequest, interestOptions } from './demoInfoRequestFields';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export default function DemoInfoRequestModal({ show, demoCode, onHide }) {
  const [form, setForm] = React.useState(emptyInfoRequest);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [showOptional, setShowOptional] = React.useState(false);

  React.useEffect(() => {
    if (show) {
      setForm(emptyInfoRequest);
      setBusy(false);
      setError('');
      setSaved(false);
      setShowOptional(false);
    }
  }, [show]);

  const updateField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const updateInterest = (key, checked) => {
    setForm((prev) => ({
      ...prev,
      interests: {
        ...prev.interests,
        [key]: checked,
      },
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!isValidEmail(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setBusy(true);
      const res = await fetch(`${API_BASE_URL}/api/demo/${encodeURIComponent(demoCode)}/info-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...form,
          sourcePath: `${window.location.pathname}${window.location.search}`,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to save request');
      }

      setSaved(true);
    } catch (err) {
      setError(err?.message || 'Unable to save request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      show={show}
      onHide={busy ? undefined : onHide}
      centered
      size="xl"
      fullscreen="sm-down"
      dialogClassName="demo-info-request-modal"
      contentClassName="border-0 shadow"
    >
      <style>{`
        .demo-info-request-modal .modal-content {
          max-height: calc(100vh - 2rem);
        }
        .demo-info-request-modal .modal-body {
          overflow: auto;
        }
        .demo-info-request-modal .modal-header,
        .demo-info-request-modal .modal-footer {
          padding-top: 0.75rem;
          padding-bottom: 0.75rem;
        }
        .demo-info-request-form {
          margin-bottom: 0;
        }
        .demo-info-request-form .form-label {
          font-weight: 600;
        }
        .demo-info-request-form .form-text {
          font-size: 0.82rem;
        }
        .demo-info-request-optional-toggle {
          display: none;
        }
        .demo-info-request-optional {
          display: block;
        }
        .demo-info-request-interests {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.2rem 0.5rem;
        }
        .demo-info-request-interests .form-check {
          margin-bottom: 0;
          font-size: 0.95rem;
        }
        @media (max-width: 767px) {
          .demo-info-request-modal .modal-header,
          .demo-info-request-modal .modal-footer {
            padding-top: 0.5rem;
            padding-bottom: 0.5rem;
          }
          .demo-info-request-modal .modal-body {
            padding-top: 0.75rem;
            padding-bottom: 0.75rem;
          }
          .demo-info-request-optional-toggle {
            display: inline-flex;
          }
          .demo-info-request-optional {
            display: none;
          }
          .demo-info-request-optional.demo-info-request-optional-open {
            display: block;
          }
          .demo-info-request-interests {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>
      <Modal.Header closeButton={!busy}>
        <Modal.Title>Request More Information</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {saved ? (
          <Alert variant="success" className="mb-0">
            Thanks — we saved your request. We&apos;ll follow up after AIED 2026.
          </Alert>
        ) : (
          <Form onSubmit={handleSubmit} className="demo-info-request-form">
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <Row className="g-2 g-md-3">
              <Col md={6}>
                <Form.Group controlId="demoInfoName" className="mb-3">
                  <Form.Label className="mb-1">Name</Form.Label>
                  <Form.Control
                    type="text"
                    value={form.name}
                    onChange={(event) => updateField('name', event.target.value)}
                    maxLength={191}
                    disabled={busy}
                    size="sm"
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group controlId="demoInfoEmail" className="mb-3">
                  <Form.Label className="mb-1">Email address</Form.Label>
                  <Form.Control
                    type="email"
                    required
                    value={form.email}
                    onChange={(event) => updateField('email', event.target.value)}
                    maxLength={255}
                    disabled={busy}
                    size="sm"
                  />
                  <Form.Text className="text-muted">
                    We will only use this email to follow up about coLearn-AI, pilots, or beta access.
                  </Form.Text>
                </Form.Group>
              </Col>

              <Col md={12}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <div className="small text-muted">Optional details help us route your request.</div>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="demo-info-request-optional-toggle p-0 text-decoration-none"
                    onClick={() => setShowOptional((prev) => !prev)}
                    aria-expanded={showOptional}
                  >
                    {showOptional ? 'Hide optional details' : 'Show optional details'}
                  </Button>
                </div>
              </Col>

              <Col md={6} className={`demo-info-request-optional ${showOptional ? 'demo-info-request-optional-open' : ''}`}>
                <Form.Group controlId="demoInfoInstitution" className="mb-3">
                  <Form.Label className="mb-1">Institution / organization</Form.Label>
                  <Form.Control
                    type="text"
                    value={form.institution}
                    onChange={(event) => updateField('institution', event.target.value)}
                    maxLength={255}
                    disabled={busy}
                    size="sm"
                  />
                </Form.Group>
              </Col>

              <Col md={6} className={`demo-info-request-optional ${showOptional ? 'demo-info-request-optional-open' : ''}`}>
                <Form.Group controlId="demoInfoRole" className="mb-3">
                  <Form.Label className="mb-1">Role</Form.Label>
                  <Form.Control
                    type="text"
                    value={form.role}
                    onChange={(event) => updateField('role', event.target.value)}
                    maxLength={255}
                    disabled={busy}
                    size="sm"
                  />
                </Form.Group>
              </Col>

              <Col md={12}>
                <Form.Group controlId="demoInfoInterests" className="mb-2">
                  <Form.Label className="mb-1">Interests</Form.Label>
                  <div className="demo-info-request-interests">
                    {interestOptions.map((option) => (
                      <Form.Check
                        key={option.key}
                        type="checkbox"
                        id={`interest-${option.key}`}
                        label={option.label}
                        checked={Boolean(form.interests[option.key])}
                        onChange={(event) => updateInterest(option.key, event.target.checked)}
                        disabled={busy}
                      />
                    ))}
                  </div>
                  <Form.Text className="text-muted">
                    Choose any that apply. One or more is helpful, but not required.
                  </Form.Text>
                </Form.Group>
              </Col>

              <Col md={12}>
                <Form.Group controlId="demoInfoMessage" className="mb-0">
                  <Form.Label className="mb-1">Message</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={form.message}
                    onChange={(event) => updateField('message', event.target.value)}
                    maxLength={5000}
                    disabled={busy}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        )}
      </Modal.Body>
      <Modal.Footer>
        {saved ? (
          <Button variant="primary" onClick={onHide}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="outline-secondary" onClick={onHide} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={busy}>
              {busy ? 'Sending…' : 'Send Request'}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
