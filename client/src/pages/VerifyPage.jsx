import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Button, Container, Alert, Card } from 'react-bootstrap';

export default function VerifyPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;

  const handleVerify = async (e) => {
    e.preventDefault();

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      });

      const data = await res.json();
      if (res.ok) {
        alert('✅ Verification successful!');
        navigate('/');
      } else {
        setError(data.error || '❌ Invalid code.');
      }
    } catch (err) {
      setError('❌ Server error. Try again.');
    }
  };

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
      <Card style={{ width: '100%', maxWidth: '400px' }}>
        <Card.Body>
          <h2 className="mb-4 text-center">Email Verification</h2>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleVerify}>
            <Form.Group className="mb-3">
              <Form.Label>Enter 6-digit Code</Form.Label>
              <Form.Control
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </Form.Group>
            <Button type="submit" className="w-100">Verify</Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
}
