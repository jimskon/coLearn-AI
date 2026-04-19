// src/pages/ManageCourseStudentsPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Container } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';


export default function ManageCourseStudentsPage() {
    const { courseId } = useParams();
    const { user } = useUser();
    const [students, setStudents] = useState([]);
    const navigate = useNavigate();
    const [courseInfo, setCourseInfo] = useState(null);



    console.log("ManageCourseStudentsPage rendered!!!", courseId, user);

    useEffect(() => {
        fetch(`${API_BASE_URL}/api/courses/${courseId}/info`)
            .then((res) => res.json())
            .then((data) => {
                console.log("Fetched course info:", data);
                setCourseInfo(data);
            })
            .catch((err) => console.error("Failed to load course info", err));
    }, [courseId]);


    useEffect(() => {
        fetch(`${API_BASE_URL}/api/courses/${courseId}/students`)
            .then((res) => res.json())
            .then(setStudents)
            .catch(err => console.error("Failed to load students:", err));
    }, [courseId]);

    const handleRemove = async (studentId) => {
        if (!window.confirm("Remove this user from the course?")) return;
        await fetch(`${API_BASE_URL}/api/courses/${courseId}/unenroll/${studentId}`, {
            method: "DELETE",
        });
        setStudents(students.filter(s => s.id !== studentId));
    };
    console.log("user ID", user.id);
    console.log("instructor ID", courseInfo?.instructor_id);
    if (!user || !courseInfo) return <Container className="mt-4">Loading...</Container>;


    return (
        <Container className="mt-4">
            <h3>Enrolled Students for {courseInfo?.name || "..."}</h3>
            <Table striped bordered hover>
                <thead>
                    <tr>
                        <th>Name</th><th>Email</th><th>Role</th>
                        {(user.role === 'root' || user.role === 'creator' || user.role === 'instructor') && <th>Actions</th>}
                    </tr>
                </thead>
                <tbody>
                    {students.map(s => (
                        <tr key={s.id}>
                            <td>{s.name}</td>
                            <td>{s.email}</td>
                            <td>{s.role}</td>
                            {(user.role === 'root' || user.role === 'creator' || user.id === courseInfo.instructor_id) && (
                                <td>
                                    <Button variant="danger" size="sm" onClick={() => handleRemove(s.id)}>Remove</Button>
                                </td>
                            )}

                        </tr>
                    ))}
                </tbody>
            </Table>
            <Button variant="secondary" onClick={() => navigate(-1)}>Back</Button>
        </Container>
    );
}
//       