// pages/ManageClassesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { Table, Button, Form, Container } from 'react-bootstrap';

export default function ManageClassesPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [newClass, setNewClass] = useState({ name: '', description: '' });

  useEffect(() => {
    if (!user || (user.role !== 'root' && user.role !== 'creator')) {
      navigate('/dashboard');
    } else {
      fetch(`${API_BASE_URL}/api/classes`)
        .then(res => res.json())
        .then(data => setClasses(data));
    }
  }, [user, navigate]);

  const handleChange = (e) => {
    setNewClass({ ...newClass, [e.target.name]: e.target.value });
  };

  const handleAdd = async () => {
    const res = await fetch(`${API_BASE_URL}/api/classes`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newClass, createdBy: user.id })
    });
    const data = await res.json();
    setClasses([...classes, data]);
    setNewClass({ name: '', description: '' });
  };

  const handleDelete = async (id) => {
    await fetch(`${API_BASE_URL}/api/classes/${id}`, { method: 'DELETE' });
    setClasses(classes.filter(c => c.id !== id));
  };

  const handleFieldChange = (id, field, value) => {
    setClasses(classes.map(c =>
      c.id === id ? { ...c, [field]: value } : c
    ));
  };

  const handleUpdate = async (updatedClass) => {
    const res = await fetch(`${API_BASE_URL}/api/classes/${updatedClass.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedClass)
    });
    const data = await res.json();
    setClasses(classes.map(c => c.id === data.id ? data : c));
  };

  return (
    <Container>
      <h2 className="mb-4">Manage Classes</h2>

      <Form className="mb-4">
        <h4>Add New Class</h4>
        <Form.Group className="mb-2" controlId="formClassName">
          <Form.Label>Class Name</Form.Label>
          <Form.Control
            type="text"
            placeholder="Enter class name"
            name="name"
            value={newClass.name}
            onChange={handleChange}
          />
        </Form.Group>
        <Form.Group className="mb-2" controlId="formDescription">
          <Form.Label>Description</Form.Label>
          <Form.Control
            type="text"
            placeholder="Enter description"
            name="description"
            value={newClass.description}
            onChange={handleChange}
          />
        </Form.Group>
        <Button variant="primary" onClick={handleAdd}>Add Class</Button>
      </Form>

      <h4>Existing Classes</h4>
      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th style={{ width: '30%' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {classes.map(c => (
            <tr key={c.id}>
              <td>
                <Form.Control
                  type="text"
                  value={c.name}
                  onChange={e => handleFieldChange(c.id, 'name', e.target.value)}
                />
              </td>
              <td>
                <Form.Control
                  type="text"
                  value={c.description}
                  onChange={e => handleFieldChange(c.id, 'description', e.target.value)}
                />
              </td>
              <td>
                <Button variant="success" size="sm" onClick={() => handleUpdate(c)} className="me-2">Update</Button>
                <Button variant="info" size="sm" onClick={() => navigate(`/class/${c.id}`)} className="me-2">Manage</Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(c.id)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Container>
  );
}
