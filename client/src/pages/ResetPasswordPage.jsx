import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Form, Button, Container, Alert, Card } from 'react-bootstrap';

export default function ResetPasswordPage() {
  const { state } = useLocation();
  const [email, setEmail] = useState(state?.email || '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const handleReset = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage('Password reset successful!');
        setTimeout(() => navigate('/'), 2000);
      } else {
        setError(data.error || 'Reset failed');
      }
    } catch (err) {
      setError('Server error');
    }
  };

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
      <Card style={{ width: '100%', maxWidth: '400px' }}>
        <Card.Body>
          <h2 className="mb-4 text-center">Reset Password</h2>
          {error && <Alert variant="danger">{error}</Alert>}
          {message && <Alert variant="success">{message}</Alert>}
          <Form onSubmit={handleReset}>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Verification Code</Form.Label>
              <Form.Control
                type="text"
                value={code}
                required
                onChange={(e) => setCode(e.target.value)}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>New Password</Form.Label>
              <Form.Control
                type="password"
                value={newPassword}
                required
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Form.Group>
            <Button type="submit" className="w-100">Reset Password</Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
}
