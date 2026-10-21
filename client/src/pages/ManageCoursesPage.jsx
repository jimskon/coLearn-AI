// src/pages/ManageCoursesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Form, Container, Row, Col, Dropdown, Modal, Alert } from 'react-bootstrap';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';

export default function ManageCoursesPage() {
  console.log("ManageCoursesPage rendered!!!");
  const { user } = useUser();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [newCourse, setNewCourse] = useState({
    name: "",
    code: "",
    section: "",
    semester: "fall",
    year: new Date().getFullYear(),
    class_id: "",
  });
  const [classList, setClassList] = useState([]);

  const selectedClass = classList.find((row) => String(row.id) === String(newCourse.class_id)) || null;
  const isDemoClassSelected = Boolean(selectedClass?.demo_mode);

  useEffect(() => {
    console.log("ManageCoursesPage useEffect: user =", user);
    if (!user) return;  // Wait for user context to load

    const canManage = ['root', 'creator', 'instructor'].includes(user?.role);

    if (!canManage) {
      navigate('/dashboard');
    } else {
      fetchCourses();
    }
  }, [user]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/classes`)
      .then((res) => res.json())
      .then((rows) => setClassList(rows))
      .catch((err) => console.error("Failed to fetch classes:", err));
  }, []);

  const fetchCourses = async () => {
    try {
      const [createdRes, enrolledRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/courses`),
        fetch(`${API_BASE_URL}/api/courses/user/${user.id}/enrollments`)
      ]);

      if (!createdRes.ok || !enrolledRes.ok) throw new Error("Failed to fetch");

      const createdCourses = await createdRes.json();
      const enrolledCourses = await enrolledRes.json();

      const combined = [...createdCourses, ...enrolledCourses];
      const uniqueCourses = Array.from(
        new Map(combined.map(course => [course.id, course])).values()
      );
      console.log("Merged visible courses:");
      uniqueCourses.forEach(course => {
        console.log(`Course: ${course.name} | instructor_id: ${course.instructor_id} | your ID: ${user.id}`);
      });
      setCourses(uniqueCourses);
    } catch (err) {
      console.error("❌ Error loading courses:", err);
      setCourses([]);
    }
  };

  const handleChange = (field, value) => {
    setNewCourse((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddCourse = async () => {
    if (
      !newCourse.name ||
      !newCourse.code ||
      !newCourse.section ||
      !newCourse.semester ||
      !newCourse.year
    ) {
      alert("Please fill in all instance details.");
      return;
    }
    console.log(
      "Add course:",
      newCourse.name,
      newCourse.code,
      newCourse.section,
      newCourse.semester,
      newCourse.year
    );
    const body = { ...newCourse, instructor_id: user.id };
    const res = await fetch(`${API_BASE_URL}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to add instance.");
      return;
    }

    setNewCourse({
      name: "",
      code: "",
      section: "",
      semester: "fall",
      year: new Date().getFullYear(),
      class_id: "",
    });
    fetchCourses();
  };

  // Edit modal: every field except instructor and class.
  const [editCourse, setEditCourse] = useState(null);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = (course) => {
    setEditError('');
    setEditCourse({
      id: course.id,
      name: course.name || '',
      code: course.code || '',
      section: course.section || '',
      semester: course.semester || 'fall',
      year: course.year || new Date().getFullYear(),
      instructor_name: course.instructor_name,
      class_name: course.class_name,
    });
  };

  const handleSaveEdit = async () => {
    if (!editCourse) return;
    setEditSaving(true);
    setEditError('');
    try {
      const { id, name, code, section, semester, year } = editCourse;
      const res = await fetch(`${API_BASE_URL}/api/courses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, code, section, semester, year }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error || "Failed to save instance.");
        return;
      }
      setEditCourse(null);
      fetchCourses();
    } catch (err) {
      setEditError("Failed to save instance.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${API_BASE_URL}/api/courses/${id}`, { method: "DELETE" });
    fetchCourses();
  };

  return (
    <Container className="mt-4">
      <h2>Manage Instances for {user?.name}</h2>

      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Join Code</th>
            <th>Section</th>
            <th>Semester</th>
            <th>Year</th>
            <th>Instructor</th>
            <th>Class</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <tr key={course.id}>
              <td>{course.name}</td>
              <td>{course.code}</td>
              <td>{course.section}</td>
              <td>{course.semester}</td>
              <td>{course.year}</td>
              <td>{course.instructor_name || 'N/A'}</td>
              <td>{course.class_name || '—'}</td>
              <td>
                <div className="d-flex flex-wrap gap-1">
                  <Dropdown>
                    <Dropdown.Toggle size="sm" variant="primary" id={`results-${course.id}`}>
                      Results
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item onClick={() => navigate(`/courses/${course.id}/progress`)}>
                        Group
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => navigate(`/courses/${course.id}/tests`)}>
                        Test
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => navigate(`/courses/${course.id}/hw`)}>
                        HW
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>

                  <Button
                    size="sm"
                    variant="info"
                    onClick={() => navigate(`/courses/${course.id}/students`)}
                  >
                    Students
                  </Button>

                  {(user.role === 'root' || user.role === 'creator' || user.id === course.instructor_id) && (
                    <Button
                      size="sm"
                      variant="warning"
                      onClick={() => openEdit(course)}
                    >
                      Edit
                    </Button>
                  )}

                  {(user.role === 'root' || user.id === course.instructor_id) && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(course.id)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <h4 className="mt-4">Add New Instance</h4>
      <Form className="mb-3">
        <Row>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Instance Name</Form.Label>
              <Form.Control
                value={newCourse.name}
                onChange={(e) => handleChange("name", e.target.value)}
              />
            </Form.Group>
          </Col>
          <Col md={2}>
              <Form.Group>
              <Form.Label>{isDemoClassSelected ? 'Demo Code' : 'Join Code'}</Form.Label>
              <Form.Control
                value={newCourse.code}
                onChange={(e) => handleChange("code", e.target.value)}
              />
              <Form.Text className="text-muted">
                {isDemoClassSelected
                  ? 'Visitors will use this code as the public demo code for the instance.'
                  : 'Students use this code to join the instance.'}
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Section</Form.Label>
              <Form.Control
                value={newCourse.section}
                onChange={(e) => handleChange("section", e.target.value)}
              />
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Semester</Form.Label>
              <Form.Select
                value={newCourse.semester}
                onChange={(e) => handleChange("semester", e.target.value)}
              >
                <option value="fall">Fall</option>
                <option value="spring">Spring</option>
                <option value="summer">Summer</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Year</Form.Label>
              <Form.Control
                type="number"
                value={newCourse.year}
                onChange={(e) => handleChange("year", parseInt(e.target.value))}
              />
            </Form.Group>
          </Col>
        </Row>
        <Row className="mt-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Class</Form.Label>
              <Form.Select
                value={newCourse.class_id}
                onChange={(e) =>
                  handleChange("class_id", parseInt(e.target.value))
                }
              >
                <option value="">Select a class</option>
                {classList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.demo_mode ? ' (Demo)' : ''}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
        {isDemoClassSelected ? (
          <div className="mt-3 text-muted">
            This instance will be created from a demo class and shown as a demo in the instance list.
          </div>
        ) : null}
        <Button className="mt-3" onClick={handleAddCourse}>
          Add Instance
        </Button>
      </Form>

      <Modal show={!!editCourse} onHide={() => setEditCourse(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Instance</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editError && <Alert variant="danger">{editError}</Alert>}
          {editCourse && (
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEdit();
              }}
            >
              <Form.Group className="mb-2">
                <Form.Label>Instance Name</Form.Label>
                <Form.Control
                  value={editCourse.name}
                  onChange={(e) => setEditCourse({ ...editCourse, name: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label>Join Code</Form.Label>
                <Form.Control
                  value={editCourse.code}
                  onChange={(e) => setEditCourse({ ...editCourse, code: e.target.value })}
                />
              </Form.Group>
              <Row>
                <Col>
                  <Form.Group className="mb-2">
                    <Form.Label>Section</Form.Label>
                    <Form.Control
                      value={editCourse.section}
                      onChange={(e) => setEditCourse({ ...editCourse, section: e.target.value })}
                    />
                  </Form.Group>
                </Col>
                <Col>
                  <Form.Group className="mb-2">
                    <Form.Label>Semester</Form.Label>
                    <Form.Select
                      value={editCourse.semester}
                      onChange={(e) => setEditCourse({ ...editCourse, semester: e.target.value })}
                    >
                      <option value="fall">Fall</option>
                      <option value="spring">Spring</option>
                      <option value="summer">Summer</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col>
                  <Form.Group className="mb-2">
                    <Form.Label>Year</Form.Label>
                    <Form.Control
                      type="number"
                      value={editCourse.year}
                      onChange={(e) => setEditCourse({ ...editCourse, year: e.target.value })}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <div className="text-muted small mt-2">
                Instructor: {editCourse.instructor_name || 'N/A'} · Class: {editCourse.class_name || '—'} (not editable)
              </div>
              <button type="submit" hidden />
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setEditCourse(null)} disabled={editSaving}>
            Cancel
          </Button>
          <Button onClick={handleSaveEdit} disabled={editSaving}>
            {editSaving ? 'Saving…' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
