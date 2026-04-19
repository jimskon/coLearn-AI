import { useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useUser } from '../context/UserContext';
import { Form, Button, Container, Row, Col, Card, Alert } from 'react-bootstrap';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { setUser } = useUser();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      console.log("Login: ", data);
      if (res.ok) {
        const loggedInUser = { name: data.name, role: data.role, id: data.id };
        localStorage.setItem("user", JSON.stringify(loggedInUser)); // ✅ store persistently
        setUser(loggedInUser); // update context
        navigate("/dashboard");
      } else {
        setError(data.error || "Login failed.");
      }
    } catch (err) {
      setError("Error connecting to server.");
    }
  };

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
      <Row className="w-100">
        <Col md={{ span: 6, offset: 3 }}>
          <Card>
            <Card.Body>
              <h2 className="mb-4 text-center">Login</h2>
              {error && <Alert variant="danger">{error}</Alert>}
              <Form onSubmit={handleSubmit}>
                <Form.Group controlId="formEmail" className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    placeholder="Enter email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Form.Group>

                <Form.Group controlId="formPassword" className="mb-3">
                  <Form.Label>Password</Form.Label>
                  <Form.Control
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Form.Group>

                <Button variant="primary" type="submit" className="w-100">Login</Button>
              </Form>
              <p className="mt-3 text-center">
                Don't have an account? <Link to="/register">Register here</Link>
              </p>
              <p className="mt-3 text-center">
                <Link to="/forgot-password">Forgot password?</Link>
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
