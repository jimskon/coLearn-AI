// src/pages/ManageCourseStudentsPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Alert, Table, Button, Container, Form, Row, Col, Card } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

const CSV_EXAMPLE = `name,email,password
Jane Smith,jsmith@example.edu,Blue-Kite-42
Raj Patel,rpatel@example.edu,Quiet!River7`;

// Split one CSV line, honoring double-quoted fields ("Smith, Jane").
function splitCsvLine(line) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') inQuotes = false;
            else cur += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
    }
    fields.push(cur);
    return fields.map(f => f.trim());
}

function parseStudentCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length && /^name\s*,\s*email\s*,\s*password$/i.test(lines[0].trim())) lines.shift();
    return lines.map(line => {
        const [name = '', email = '', password = ''] = splitCsvLine(line);
        return { name, email, password };
    });
}

// Two visible (plain-text) password fields; flags a mismatch as you type.
function PasswordPair({ value, confirm, onChange, onConfirmChange, disabled }) {
    const mismatch = confirm.length > 0 && value !== confirm;
    return (
        <Row className="g-2 mt-1">
            <Col md={6}>
                <Form.Label>Password</Form.Label>
                <Form.Control
                    type="text"
                    autoComplete="off"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                />
            </Col>
            <Col md={6}>
                <Form.Label>Confirm password</Form.Label>
                <Form.Control
                    type="text"
                    autoComplete="off"
                    value={confirm}
                    onChange={(e) => onConfirmChange(e.target.value)}
                    isInvalid={mismatch}
                    disabled={disabled}
                />
                <Form.Control.Feedback type="invalid">Passwords do not match.</Form.Control.Feedback>
            </Col>
        </Row>
    );
}

const STATUS_LABELS = {
    added: 'Added',
    already_enrolled: 'Already enrolled',
    invalid: 'Invalid',
    duplicate: 'Duplicate in file',
};

export default function ManageCourseStudentsPage() {
    const { courseId } = useParams();
    const { user } = useUser();
    const [students, setStudents] = useState([]);
    const navigate = useNavigate();
    const [courseInfo, setCourseInfo] = useState(null);
    const isDemoInstructor = user?.demo_mode === 'instructor';

    const [newName, setNewName] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newPassword2, setNewPassword2] = useState('');
    const [csvFile, setCsvFile] = useState(null);
    const [fileInputKey, setFileInputKey] = useState(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const [bulkResults, setBulkResults] = useState(null);

    useEffect(() => {
        fetch(`${API_BASE_URL}/api/courses/${courseId}/info`)
            .then((res) => res.json())
            .then(setCourseInfo)
            .catch((err) => console.error("Failed to load course info", err));
    }, [courseId]);

    const loadStudents = () =>
        fetch(`${API_BASE_URL}/api/courses/${courseId}/students`)
            .then((res) => res.json())
            .then(setStudents)
            .catch(err => console.error("Failed to load students:", err));

    useEffect(() => { loadStudents(); }, [courseId]);

    const handleRemove = async (studentId) => {
        if (!window.confirm("Remove this user from the instance?")) return;
        await fetch(`${API_BASE_URL}/api/courses/${courseId}/unenroll/${studentId}`, {
            method: "DELETE",
        });
        setStudents(students.filter(s => s.id !== studentId));
    };

    const submitStudents = async (list) => {
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/courses/${courseId}/students`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ students: list }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage({ variant: 'danger', text: data.error || 'Failed to add students.' });
                return null;
            }
            await loadStudents();
            return data.results || [];
        } catch (err) {
            setMessage({ variant: 'danger', text: 'Failed to add students.' });
            return null;
        } finally {
            setBusy(false);
        }
    };

    const handleAddOne = async (e) => {
        e.preventDefault();
        if (!newName.trim() || !newEmail.trim() || !newPassword) {
            setMessage({ variant: 'warning', text: 'Enter a name, an email and a password.' });
            return;
        }
        if (newPassword !== newPassword2) {
            setMessage({ variant: 'warning', text: 'The two passwords do not match.' });
            return;
        }
        const results = await submitStudents([{ name: newName, email: newEmail, password: newPassword }]);
        const r = results?.[0];
        if (!r) return;
        if (r.status === 'added') {
            setMessage({ variant: 'success', text: `Added ${r.name} (${r.email}).` });
            setNewName('');
            setNewEmail('');
            setNewPassword('');
            setNewPassword2('');
        } else {
            setMessage({ variant: 'warning', text: `${r.email}: ${r.error || STATUS_LABELS[r.status]}` });
        }
    };

    const handleBulkUpload = async (e) => {
        e.preventDefault();
        if (!csvFile) {
            setMessage({ variant: 'warning', text: 'Choose a CSV file first.' });
            return;
        }
        const list = parseStudentCsv(await csvFile.text());
        if (list.length === 0) {
            setMessage({ variant: 'warning', text: 'The file has no student rows.' });
            return;
        }
        const results = await submitStudents(list);
        if (!results) return;
        setBulkResults(results);
        const added = results.filter(r => r.status === 'added').length;
        setMessage({
            variant: added === results.length ? 'success' : 'info',
            text: `Added ${added} of ${results.length} students. See details below.`,
        });
        setCsvFile(null);
        setFileInputKey(k => k + 1);
    };

    if (!user || !courseInfo) return <Container className="mt-4">Loading...</Container>;

    const canEdit = user.role === 'root' || user.role === 'creator' || user.id === courseInfo.instructor_id;
    const editDisabled = isDemoInstructor || busy;

    return (
        <Container className="mt-4">
            <h3>Students in {courseInfo?.name || "..."}</h3>
            {isDemoInstructor ? (
              <Alert variant="info" className="mb-3">
                Demo instructor mode: roster edit controls are visible but disabled.
              </Alert>
            ) : null}
            <Table striped bordered hover>
                <thead>
                    <tr>
                        <th>Name</th><th>Email</th><th>Role</th>
                        {canEdit && <th>Actions</th>}
                    </tr>
                </thead>
                <tbody>
                    {students.map(s => (
                        <tr key={s.id}>
                            <td>{s.name}</td>
                            <td>{s.email}</td>
                            <td>{s.role}</td>
                            {canEdit && (
                                <td>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      onClick={() => handleRemove(s.id)}
                                      disabled={isDemoInstructor}
                                      title={isDemoInstructor ? 'Disabled in instructor demo mode' : undefined}
                                    >
                                      Remove
                                    </Button>
                                </td>
                            )}
                        </tr>
                    ))}
                    {students.length === 0 && (
                        <tr><td colSpan={canEdit ? 4 : 3} className="text-muted">No students yet.</td></tr>
                    )}
                </tbody>
            </Table>

            {canEdit && (
                <>
                    {message && (
                        <Alert variant={message.variant} dismissible onClose={() => setMessage(null)}>
                            {message.text}
                        </Alert>
                    )}

                    <Card className="mb-3">
                        <Card.Body>
                            <Card.Title as="h5">Add a student</Card.Title>
                            <Form onSubmit={handleAddOne}>
                                <Row className="g-2">
                                    <Col md={6}>
                                        <Form.Label>Name</Form.Label>
                                        <Form.Control
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            disabled={editDisabled}
                                        />
                                    </Col>
                                    <Col md={6}>
                                        <Form.Label>Email</Form.Label>
                                        <Form.Control
                                            type="email"
                                            value={newEmail}
                                            onChange={(e) => setNewEmail(e.target.value)}
                                            disabled={editDisabled}
                                        />
                                    </Col>
                                </Row>
                                <PasswordPair
                                    value={newPassword}
                                    confirm={newPassword2}
                                    onChange={setNewPassword}
                                    onConfirmChange={setNewPassword2}
                                    disabled={editDisabled}
                                />
                                <Form.Text className="text-muted d-block">
                                    The password is only used if this creates a new account; an existing
                                    account keeps its current password.
                                </Form.Text>
                                <Button type="submit" className="mt-2" disabled={editDisabled}>Add Student</Button>
                            </Form>
                        </Card.Body>
                    </Card>

                    <Card className="mb-3">
                        <Card.Body>
                            <Card.Title as="h5">Bulk add from CSV</Card.Title>
                            <p className="mb-2">
                                Upload a <code>.csv</code> file with one student per line: name, email, password.
                                The <code>name,email,password</code> header line is optional. Put any value
                                that contains a comma in double quotes.
                            </p>
                            <pre className="bg-light border rounded p-2">{CSV_EXAMPLE}</pre>
                            <Form onSubmit={handleBulkUpload}>
                                <Form.Label>CSV file</Form.Label>
                                <Form.Control
                                    key={fileInputKey}
                                    type="file"
                                    accept=".csv,text/csv"
                                    onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                                    disabled={editDisabled}
                                />
                                <Form.Text className="text-muted d-block">
                                    Students who already have an account are enrolled and keep their current
                                    password; the password column is only used for new accounts.
                                </Form.Text>
                                <Button type="submit" variant="success" className="mt-2" disabled={editDisabled}>
                                    Upload &amp; Add
                                </Button>
                            </Form>

                            {bulkResults && (
                                <Table size="sm" bordered className="mt-3">
                                    <thead>
                                        <tr><th>Name</th><th>Email</th><th>Result</th></tr>
                                    </thead>
                                    <tbody>
                                        {bulkResults.map((r, i) => (
                                            <tr key={i} className={r.status === 'added' ? '' : 'table-warning'}>
                                                <td>{r.name}</td>
                                                <td>{r.email}</td>
                                                <td>
                                                    {STATUS_LABELS[r.status] || r.status}
                                                    {r.status === 'added' && r.created ? ' (new account)' : ''}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Card.Body>
                    </Card>
                </>
            )}

            <Button variant="secondary" onClick={() => navigate(-1)}>Back</Button>
        </Container>
    );
}
