import React from 'react';
import { Container, Nav, Navbar } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useUser } from '../context/UserContext';

export default function BootstrapLayout({ children }) {
  const { user } = useUser();

  const isRootOrCreator = ['root', 'creator'].includes(user?.role);
  const canManageCourses = ['root', 'creator', 'instructor'].includes(user?.role);

  return (
    <><h1>hello world</h1>
      <Navbar bg="primary" variant="dark" expand="lg" className="mb-4">
        <Container>
          <Navbar.Brand as={Link} to="/dashboard">POGIL ITS</Navbar.Brand>

          <Navbar.Toggle aria-controls="basic-navbar-nav" />
          <Navbar.Collapse id="basic-navbar-nav">
            <Nav className="me-auto">
              <Nav.Link as={Link} to="/dashboard">Dashboard</Nav.Link>

              {isRootOrCreator && (
                <Nav.Link as={Link} to="/manage-classes">Manage Classes</Nav.Link>
              )}

              {canManageCourses && (
                <Nav.Link as={Link} to="/manage-courses">Manage Courses</Nav.Link>
              )}

              <Nav.Link as={Link} to="/register">Register</Nav.Link>
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <Container>
        {children}
      </Container>
    </>
  );
}
