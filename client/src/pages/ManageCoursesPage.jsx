// src/pages/ManageCoursesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Form, Container, Row, Col, Modal, Alert, Badge, Spinner } from 'react-bootstrap';
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
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [folderState, setFolderState] = useState(null);
  const [folderUrlInput, setFolderUrlInput] = useState('');
  const [folderLoading, setFolderLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [folderError, setFolderError] = useState('');
  const [folderSuccess, setFolderSuccess] = useState('');
  const [verifiedFolder, setVerifiedFolder] = useState(null);

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

  const handleDelete = async (id) => {
    await fetch(`${API_BASE_URL}/api/courses/${id}`, { method: "DELETE" });
    fetchCourses();
  };

  const canManageFolder = (course) =>
    user?.role === 'root' || user?.role === 'creator' || user?.id === course.instructor_id;

  const getFolderBadge = (course) => {
    if (!course.google_folder_id) {
      return <Badge bg="secondary">No Folder</Badge>;
    }

    if (course.google_folder_status === 'verified') {
      return <Badge bg="success">Verified</Badge>;
    }

    if (course.google_folder_status === 'access_error') {
      return <Badge bg="danger">Access Problem</Badge>;
    }

    return <Badge bg="warning" text="dark">Needs Check</Badge>;
  };

  const closeFolderModal = () => {
    if (folderLoading || verifyLoading || saveLoading || removeLoading) return;
    setShowFolderModal(false);
    setSelectedCourse(null);
    setFolderState(null);
    setFolderUrlInput('');
    setFolderError('');
    setFolderSuccess('');
    setVerifiedFolder(null);
  };

  const openFolderModal = async (course) => {
    setSelectedCourse(course);
    setShowFolderModal(true);
    setFolderLoading(true);
    setFolderError('');
    setFolderSuccess('');
    setVerifiedFolder(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/${course.id}/folder`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load folder information.');
      }

      setFolderState(data);
      setFolderUrlInput(data.folder_url || '');
    } catch (err) {
      setFolderError(err.message || 'Failed to load folder information.');
      setFolderState(null);
      setFolderUrlInput(course.google_folder_url || '');
    } finally {
      setFolderLoading(false);
    }
  };

  const handleVerifyFolder = async () => {
    if (!selectedCourse) return;

    setVerifyLoading(true);
    setFolderError('');
    setFolderSuccess('');
    setVerifiedFolder(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/${selectedCourse.id}/folder/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: folderUrlInput }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify folder access.');
      }

      setVerifiedFolder({
        folderUrl: folderUrlInput,
        folderId: data.folder_id,
        folderName: data.folder_name,
      });
      setFolderSuccess(`Verified access to ${data.folder_name || 'folder'}.`);
    } catch (err) {
      setFolderError(err.message || 'Failed to verify folder access.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleSaveFolder = async () => {
    if (!selectedCourse || !verifiedFolder || verifiedFolder.folderUrl !== folderUrlInput) return;

    setSaveLoading(true);
    setFolderError('');
    setFolderSuccess('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/${selectedCourse.id}/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: folderUrlInput }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save course folder.');
      }

      setFolderState({
        course_id: selectedCourse.id,
        has_folder: true,
        folder_url: data.folder_url,
        folder_id: data.folder_id,
        folder_name: data.folder_name,
        status: data.status,
        verified_at: new Date().toISOString(),
      });
      setFolderSuccess(`Saved ${data.folder_name || 'course folder'}.`);
      await fetchCourses();
    } catch (err) {
      setFolderError(err.message || 'Failed to save course folder.');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleRemoveFolder = async () => {
    if (!selectedCourse) return;
    if (!window.confirm('Remove the folder attachment from this instance? Existing activities will not be changed.')) {
      return;
    }

    setRemoveLoading(true);
    setFolderError('');
    setFolderSuccess('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/${selectedCourse.id}/folder`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove course folder.');
      }

      setFolderState({
        course_id: selectedCourse.id,
        has_folder: false,
      });
      setFolderUrlInput('');
      setVerifiedFolder(null);
      setFolderSuccess('Course folder removed.');
      await fetchCourses();
    } catch (err) {
      setFolderError(err.message || 'Failed to remove course folder.');
    } finally {
      setRemoveLoading(false);
    }
  };

  const folderNeedsReverify = verifiedFolder && verifiedFolder.folderUrl !== folderUrlInput;

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
            <th>Folder</th>
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
              <td>{getFolderBadge(course)}</td>
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

                  {canManageFolder(course) && (
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => openFolderModal(course)}
                    >
                      {course.google_folder_id ? 'Manage Folder' : 'Attach Folder'}
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
              <Form.Label>Join Code</Form.Label>
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
          Add Instance
        </Button>
      </Form>

      <Modal show={showFolderModal} onHide={closeFolderModal} centered>
        <Modal.Header closeButton={!folderLoading && !verifyLoading && !saveLoading && !removeLoading}>
          <Modal.Title>
            {folderState?.has_folder ? 'Manage Instance Folder' : 'Attach Instance Folder'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {folderLoading ? (
            <div className="d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" />
              <span>Loading folder settings...</span>
            </div>
          ) : (
            <>
              <p className="text-muted mb-3">
                Local activities for this instance will use this Google Drive folder by default.
                External activities can still be added separately.
              </p>

              {folderError && <Alert variant="danger">{folderError}</Alert>}
              {folderSuccess && <Alert variant="success">{folderSuccess}</Alert>}
              {folderNeedsReverify && (
                <Alert variant="warning" className="py-2">
                  Folder URL changed. Verify again before saving.
                </Alert>
              )}

              <Form.Group className="mb-3">
                <Form.Label>Google Folder URL</Form.Label>
                <Form.Control
                  type="url"
                  value={folderUrlInput}
                  onChange={(e) => {
                    setFolderUrlInput(e.target.value);
                    setFolderError('');
                    setFolderSuccess('');
                  }}
                  placeholder="https://drive.google.com/drive/folders/..."
                />
                <Form.Text className="text-muted">
                  Make sure the service account has editor access to this folder.
                </Form.Text>
              </Form.Group>

              {folderState?.has_folder && (
                <div className="mb-3">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <strong>Current status:</strong>
                    <Badge bg={folderState.status === 'verified' ? 'success' : 'secondary'}>
                      {folderState.status === 'verified' ? 'Verified' : 'Attached'}
                    </Badge>
                  </div>
                  {folderState.folder_name && <div><strong>Folder:</strong> {folderState.folder_name}</div>}
                  {folderState.folder_id && <div><strong>Folder ID:</strong> {folderState.folder_id}</div>}
                  {folderState.folder_url && (
                    <div className="mt-2">
                      <a href={folderState.folder_url} target="_blank" rel="noreferrer">
                        Open Folder
                      </a>
                    </div>
                  )}
                </div>
              )}

              {verifiedFolder && verifiedFolder.folderUrl === folderUrlInput && (
                <Alert variant="info" className="py-2 mb-0">
                  Ready to save: {verifiedFolder.folderName || verifiedFolder.folderId}
                </Alert>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between">
          <div>
            {folderState?.has_folder && (
              <Button
                variant="outline-danger"
                onClick={handleRemoveFolder}
                disabled={folderLoading || verifyLoading || saveLoading || removeLoading}
              >
                {removeLoading ? 'Removing...' : 'Remove Folder'}
              </Button>
            )}
          </div>
          <div className="d-flex gap-2">
            <Button
              variant="secondary"
              onClick={closeFolderModal}
              disabled={folderLoading || verifyLoading || saveLoading || removeLoading}
            >
              Close
            </Button>
            <Button
              variant="outline-primary"
              onClick={handleVerifyFolder}
              disabled={!folderUrlInput || folderLoading || verifyLoading || saveLoading || removeLoading}
            >
              {verifyLoading ? 'Verifying...' : 'Verify Access'}
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveFolder}
              disabled={
                !verifiedFolder ||
                verifiedFolder.folderUrl !== folderUrlInput ||
                folderLoading ||
                verifyLoading ||
                saveLoading ||
                removeLoading
              }
            >
              {saveLoading ? 'Saving...' : 'Save Folder'}
            </Button>
          </div>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
