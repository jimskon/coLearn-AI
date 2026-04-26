import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { Table, Button, Form, Container, Alert, Card, Spinner } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

const roles = ['student', 'instructor', 'creator', 'root'];

export default function AdminUsersPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [activeUsersOpen, setActiveUsersOpen] = useState(false);
  const [activeUsersLoading, setActiveUsersLoading] = useState(false);
  const [activeUsersError, setActiveUsersError] = useState('');
  const [activeUsersAsOf, setActiveUsersAsOf] = useState('');

  useEffect(() => {
    if (user?.role !== 'root') {
      navigate('/dashboard');
    } else {
	fetch(`${API_BASE_URL}/api/users/admin/users`)
	    .then(res => res.json())
	    .then(data => {
		console.log(" Fetched users:", data);
		setUsers(Array.isArray(data) ? data : []);
	    })
	    .catch(err => console.error("❌ Failed to fetch users", err));
	
    }
  }, [user, navigate]);

  const handleRoleChange = async (id, newRole) => {
    const res = await fetch(`${API_BASE_URL}/api/users/admin/users/${id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role: newRole })
    });

    if (res.ok) {
      setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
    } else {
      alert("Failed to update role");
    }
  };

  const loadActiveUsers = async () => {
    setActiveUsersLoading(true);
    setActiveUsersError('');

    try {
      const res = await fetch(`${API_BASE_URL}/api/users/admin/active-users`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || 'Failed to fetch active users');

      setActiveUsers(Array.isArray(data?.users) ? data.users : []);
      setActiveUsersAsOf(data?.asOf || '');
      setActiveUsersOpen(true);
    } catch (err) {
      console.error("❌ Failed to fetch active users", err);
      setActiveUsersError(err?.message || 'Failed to fetch active users');
      setActiveUsersOpen(true);
    } finally {
      setActiveUsersLoading(false);
    }
  };

  console.log("👥 Rendering users:", users);
  return (
    <Container>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-4">
        <h2 className="mb-0">Manage Users</h2>
        <Button
          variant="outline-primary"
          onClick={loadActiveUsers}
          disabled={activeUsersLoading}
        >
          {activeUsersLoading ? 'Loading Active Users…' : 'Active Users'}
        </Button>
      </div>

      {activeUsersOpen && (
        <Card className="mb-4">
          <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <strong>Active Users</strong>
              {activeUsersAsOf && (
                <span className="text-muted ms-2">
                  as of {new Date(activeUsersAsOf).toLocaleString()}
                </span>
              )}
            </div>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setActiveUsersOpen(false)}
            >
              Hide
            </Button>
          </Card.Header>
          <Card.Body>
            {activeUsersLoading ? (
              <Spinner animation="border" size="sm" />
            ) : activeUsersError ? (
              <Alert variant="danger" className="mb-0">{activeUsersError}</Alert>
            ) : activeUsers.length === 0 ? (
              <Alert variant="info" className="mb-0">No logged-in users found right now.</Alert>
            ) : (
              <Table striped bordered hover responsive className="mb-0">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Sessions</th>
                    <th>Running Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {activeUsers.map((activeUser) => (
                    <tr key={activeUser.id}>
                      <td>{activeUser.name}</td>
                      <td>{activeUser.email}</td>
                      <td>{activeUser.role}</td>
                      <td>{activeUser.session_count}</td>
                      <td>
                        {activeUser.running_activities?.length ? (
                          activeUser.running_activities.map((activity) => (
                            <div key={`${activeUser.id}-${activity.instance_id}`}>
                              {activity.activity_title || 'Untitled activity'}
                              {activity.course_name ? ` — ${activity.course_name}` : ''}
                              {activity.group_number ? ` (Group ${activity.group_number})` : ''}
                            </div>
                          ))
                        ) : (
                          <span className="text-muted">Not in an activity</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card.Body>
        </Card>
      )}

      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Current Role</th>
            <th>Change Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.name}</td>
              <td>{u.role}</td>
              <td>
                <Form.Select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}>
                  {roles.map(r => <option key={r} value={r}>{r}</option>)}
                </Form.Select>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Container>
  );
}
