// src/pages/ManageCoursesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Form, Container, Row, Col } from 'react-bootstrap';
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
      alert("Please fill in all course details.");
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
    await fetch(`${API_BASE_URL}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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

  const handleDelete = async (id) => {
    await fetch(`${API_BASE_URL}/api/courses/${id}`, { method: "DELETE" });
    fetchCourses();
  };

  return (
    <Container className="mt-4">
      <h2>Manage Courses for {user?.name}</h2>

      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Code</th>
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
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => navigate(`/courses/${course.id}/progress`)}
                  >
                    View Progress
                  </Button>

                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => navigate(`/courses/${course.id}/tests`)}
                  >
                    Test Results
                  </Button>

                  <Button
                    size="sm"
                    variant="info"
                    onClick={() => navigate(`/courses/${course.id}/students`)}
                  >
                    View Students
                  </Button>

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

      <h4 className="mt-4">Add New Course</h4>
      <Form className="mb-3">
        <Row>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Name</Form.Label>
              <Form.Control
                value={newCourse.name}
                onChange={(e) => handleChange("name", e.target.value)}
              />
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Code</Form.Label>
              <Form.Control
                value={newCourse.code}
                onChange={(e) => handleChange("code", e.target.value)}
              />
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
                    {c.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
        <Button className="mt-3" onClick={handleAddCourse}>
          Add Course
        </Button>
      </Form>
    </Container>
  );
}
