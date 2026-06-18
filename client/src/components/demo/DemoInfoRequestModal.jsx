// src/components/demo/DemoInfoRequestModal.jsx
import React from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
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

  React.useEffect(() => {
    if (show) {
      setForm(emptyInfoRequest);
      setBusy(false);
      setError('');
      setSaved(false);
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
    <Modal show={show} onHide={busy ? undefined : onHide} centered size="lg">
      <Modal.Header closeButton={!busy}>
        <Modal.Title>Request More Information</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {saved ? (
          <Alert variant="success" className="mb-0">
            Thanks — we saved your request. We&apos;ll follow up after AIED 2026.
          </Alert>
        ) : (
          <Form onSubmit={handleSubmit}>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <Form.Group className="mb-3" controlId="demoInfoName">
              <Form.Label>Name</Form.Label>
              <Form.Control
                type="text"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                maxLength={191}
                disabled={busy}
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="demoInfoEmail">
              <Form.Label>Email address</Form.Label>
              <Form.Control
                type="email"
                required
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                maxLength={255}
                disabled={busy}
              />
              <Form.Text className="text-muted">
                We will only use this email to follow up about coLearn-AI, pilots, or beta access.
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3" controlId="demoInfoInstitution">
              <Form.Label>Institution / organization</Form.Label>
              <Form.Control
                type="text"
                value={form.institution}
                onChange={(event) => updateField('institution', event.target.value)}
                maxLength={255}
                disabled={busy}
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="demoInfoRole">
              <Form.Label>Role</Form.Label>
              <Form.Control
                type="text"
                value={form.role}
                onChange={(event) => updateField('role', event.target.value)}
                maxLength={255}
                disabled={busy}
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="demoInfoInterests">
              <Form.Label>Interests</Form.Label>
              <div className="d-grid gap-2">
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

            <Form.Group className="mb-0" controlId="demoInfoMessage">
              <Form.Label>Message</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={form.message}
                onChange={(event) => updateField('message', event.target.value)}
                maxLength={5000}
                disabled={busy}
              />
            </Form.Group>
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
