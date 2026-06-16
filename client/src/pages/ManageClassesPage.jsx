// pages/ManageClassesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { Table, Button, Form, Container, Modal } from 'react-bootstrap';

export default function ManageClassesPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [showClassModal, setShowClassModal] = useState(false);
  const emptyForm = {
    id: null,
    name: '',
    level: '',
    topic_domain: '',
    description: '',
    demo_mode: false,
  };
  const [classForm, setClassForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    if (!user || (user.role !== 'root' && user.role !== 'creator')) {
      navigate('/dashboard');
    } else {
      fetch(`${API_BASE_URL}/api/classes`)
        .then(res => res.json())
        .then(data => setClasses(data));
    }
  }, [user, navigate]);

  const openCreateModal = () => {
    setClassForm(emptyForm);
    setModalError('');
    setShowClassModal(true);
  };

  const openEditModal = (classRow) => {
    setClassForm({
      id: classRow.id,
      name: classRow.name || '',
      level: classRow.level || '',
      topic_domain: classRow.topic_domain || '',
      description: classRow.description || '',
      demo_mode: Boolean(classRow.demo_mode),
    });
    setModalError('');
    setShowClassModal(true);
  };

  const handleDelete = async (id) => {
    await fetch(`${API_BASE_URL}/api/classes/${id}`, { method: 'DELETE' });
    setClasses(classes.filter(c => c.id !== id));
  };

  const handleModalFieldChange = (e) => {
    const { name, type, checked, value } = e.target;
    setClassForm({ ...classForm, [name]: type === 'checkbox' ? checked : value });
  };

  const handleSaveClass = async (e) => {
    e?.preventDefault?.();
    const trimmedName = classForm.name.trim();

    if (!trimmedName) {
      setModalError('Class name is required.');
      return;
    }

    setIsSaving(true);
    setModalError('');

    const payload = {
      name: trimmedName,
      level: classForm.level.trim() || null,
      topic_domain: classForm.topic_domain.trim() || null,
      description: classForm.description.trim() || null,
      demo_mode: Boolean(classForm.demo_mode),
    };

    try {
      const isEditing = Boolean(classForm.id);
      const res = await fetch(
        isEditing
          ? `${API_BASE_URL}/api/classes/${classForm.id}`
          : `${API_BASE_URL}/api/classes`,
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isEditing ? payload : { ...payload, createdBy: user.id }
          ),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save class');
      }

      if (isEditing) {
        setClasses(classes.map(c => (String(c.id) === String(data.id) ? data : c)));
      } else {
        setClasses([...classes, data]);
      }

      setShowClassModal(false);
      setClassForm(emptyForm);
    } catch (err) {
      setModalError(err.message || 'Failed to save class');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Container>
      <h2 className="mb-4">Manage Classes</h2>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Existing Classes</h4>
        <Button type="button" variant="primary" onClick={openCreateModal}>
          Create Class
        </Button>
      </div>

      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Level</th>
            <th>Topic / Domain</th>
            <th>Mode</th>
            <th>Description</th>
            <th style={{ width: '30%' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {classes.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.level || <span className="text-muted">—</span>}</td>
              <td>{c.topic_domain || <span className="text-muted">—</span>}</td>
              <td>
                {c.demo_mode ? <span className="badge bg-warning text-dark">Demo</span> : <span className="text-muted">Standard</span>}
              </td>
              <td>{c.description || <span className="text-muted">—</span>}</td>
              <td>
                <Button type="button" variant="success" size="sm" onClick={() => openEditModal(c)} className="me-2">Update</Button>
                <Button type="button" variant="info" size="sm" onClick={() => navigate(`/class/${c.id}`)} className="me-2">Manage</Button>
                <Button type="button" variant="danger" size="sm" onClick={() => handleDelete(c.id)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Modal show={showClassModal} onHide={() => !isSaving && setShowClassModal(false)} centered>
        <Modal.Header closeButton={!isSaving}>
          <Modal.Title>{classForm.id ? 'Update Class' : 'Create Class'}</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleSaveClass}>
          <Modal.Body>
            <Form.Group className="mb-3" controlId="className">
              <Form.Label>Class Name</Form.Label>
              <Form.Control
                type="text"
                name="name"
                value={classForm.name}
                onChange={handleModalFieldChange}
                placeholder="Enter class name"
                autoFocus
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="classLevel">
              <Form.Label>Level</Form.Label>
              <Form.Control
                type="text"
                name="level"
                value={classForm.level}
                onChange={handleModalFieldChange}
                placeholder="First-year college"
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="classTopicDomain">
              <Form.Label>Topic / Domain</Form.Label>
              <Form.Control
                type="text"
                name="topic_domain"
                value={classForm.topic_domain}
                onChange={handleModalFieldChange}
                placeholder="Computer Science"
              />
            </Form.Group>
            <Form.Group controlId="classDescription">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                name="description"
                value={classForm.description}
                onChange={handleModalFieldChange}
                placeholder="Describe the class"
              />
            </Form.Group>
            <Form.Group className="mt-3" controlId="classDemoMode">
              <Form.Check
                type="checkbox"
                name="demo_mode"
                checked={Boolean(classForm.demo_mode)}
                onChange={handleModalFieldChange}
                label="Demo mode"
              />
              <Form.Text className="text-muted">
                Demo classes use a demo code when you create instances and are labeled as demos in the instance list.
              </Form.Text>
            </Form.Group>
            {modalError ? <div className="text-danger mt-3">{modalError}</div> : null}
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" variant="secondary" onClick={() => setShowClassModal(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {classForm.id ? 'Save Changes' : 'Create Class'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Container>
  );
}
