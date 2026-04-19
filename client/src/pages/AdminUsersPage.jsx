import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { Table, Button, Form, Container } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

const roles = ['student', 'instructor', 'creator', 'root'];

export default function AdminUsersPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);

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
      body: JSON.stringify({ role: newRole })
    });

    if (res.ok) {
      setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
    } else {
      alert("Failed to update role");
    }
  };
console.log("👥 Rendering users:", users);
  return (
    <Container>
      <h2 className="mb-4">Manage Users</h2>
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
