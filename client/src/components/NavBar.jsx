import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { Modal } from 'react-bootstrap';
import { FaUserFriends } from 'react-icons/fa';

// ✅ Map short roles to full names
const roleLabels = {
  qc: 'Quality Control',
  analyst: 'Analyst',
  spokesperson: 'Spokesperson',
  facilitator: 'Facilitator'
};


export default function NavBar({ bgColor = "dark", fixed = false, statusText = "", roleLabel = "", groupMembers = [], activeStudentId = null }) {



  const { user, setUser, loading } = useUser();

  const navigate = useNavigate();

  const [showParticipants, setShowParticipants] = useState(false);


  const handleLogout = async () => {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }); // Optional: only if your backend supports logout

    localStorage.removeItem('user'); // Clear persisted user
    setUser(null);                   // Update context
    navigate("/", { replace: true }); // Redirect without reloading the page
  };


  if (loading) return null;




  return (
    <>
      <Navbar bg={bgColor || "dark"} variant="dark" expand="lg" className="mb-4 fixed-top flex-nowrap">


        <Container>
          <Navbar.Brand
            href="https://colearn-ai.com"
            target="_blank"
            rel="noopener noreferrer"
            className="d-flex align-items-center gap-2"
          >
            {/* SKON logo (unchanged) */}
            <img
              src={`${import.meta.env.BASE_URL}images/SKON-logo.png`}
              alt="skön LLC Logo"
              style={{ height: 30 }}
            />

            {/* coLearn-AI navbar logo */}
            <img
              src={`${import.meta.env.BASE_URL}images/coLearnLogoWhite40.png`}
              alt="coLearn-AI"
              style={{ height: 30 }}
            />
          </Navbar.Brand>


          <Navbar.Toggle aria-controls="coLearn-AI--navbar" />
          <Navbar.Collapse id="coLearn-AI--navbar">
            <Nav className="me-auto flex-row gap-3">
              {user && (
                <>
                  <Nav.Link as={Link} to="/dashboard" className="px-2">
                    Dashboard
                  </Nav.Link>
                  {["root", "creator", "instructor"].includes(user.role) && (
                    <Nav.Link as={Link} to="/manage-courses" className="px-2">
                      Manage Courses
                    </Nav.Link>
                  )}
                  {(user.role === "root" || user.role === "creator") && (
                    <Nav.Link as={Link} to="/manage-classes" className="px-2">
                      Manage Classes
                    </Nav.Link>
                  )}
                  {user.role === "root" && (
                    <Nav.Link as={Link} to="/admin/users" className="px-2">
                      Manage Users
                    </Nav.Link>
                  )}
                </>
              )}
            </Nav>



            <Nav className="ms-auto d-flex align-items-center flex-row gap-3">

              {user && (
                <>
                  {statusText && (
                    <Navbar.Text className="text-white me-5">
                      {statusText}
                    </Navbar.Text>
                  )}

                  <div className="d-flex align-items-center">
                    <Navbar.Text className="text-white me-3">
                      {roleLabel
                        ? `${roleLabel}, ${user.name} (${user.role})`
                        : `Welcome, ${user.name} (${user.role})`}
                    </Navbar.Text>

                    {groupMembers.length > 0 && (
                      <Button
                        variant="outline-light"
                        size="sm"
                        onClick={() => setShowParticipants(true)}
                        className="me-2"
                      >
                        <FaUserFriends />
                      </Button>
                    )}

                    <Button
                      variant="outline-light"
                      size="sm"
                      onClick={handleLogout}
                    >
                      Logout
                    </Button>
                  </div>

                </>
              )}

              {!user && (
                <div className="d-flex align-items-center">
                  <Nav.Link as={Link} to="/register">
                    Register
                  </Nav.Link>
                  <Nav.Link as={Link} to="/">
                    Login
                  </Nav.Link>
                </div>
              )}
            </Nav>

          </Navbar.Collapse>
        </Container>
      </Navbar>

      {groupMembers.length > 0 && (
        <Modal show={showParticipants} onHide={() => setShowParticipants(false)}>
          <Modal.Header closeButton>
            <Modal.Title>Group Members</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {groupMembers.map(member => (
              <div key={member.student_id} className="mb-2">
                <strong>{member.name}</strong> — {roleLabels[member.role] || member.role}
                {member.student_id === activeStudentId && (
                  <span className="ms-2 text-success">(active)</span>
                )}
              </div>
            ))}

          </Modal.Body>
        </Modal>
      )}
    </>
  );
}
