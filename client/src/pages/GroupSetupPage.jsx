// GroupSetupPage.jsx

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Card } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { normalizeDbDatetime, utcToLocalInputValue, formatLocalDateTime } from '../utils/time';


export default function GroupSetupPage() {
  const { courseId, activityId } = useParams();
  const navigate = useNavigate();

  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState({});
  const [groups, setGroups] = useState([]);

  const [groupSize, setGroupSize] = useState(4);
  const [useRoles, setUseRoles] = useState(true);

  // NEW: test-related state
  const [isTest, setIsTest] = useState(false);
  const [testStartAt, setTestStartAt] = useState('');          // datetime-local string
  const [testDurationMinutes, setTestDurationMinutes] = useState(30);
  const [lockedBeforeStart, setLockedBeforeStart] = useState(true);
  const [lockedAfterEnd, setLockedAfterEnd] = useState(true);

  const [activities, setActivities] = useState([]);
  const [cloneFromActivityId, setCloneFromActivityId] = useState('');


  useEffect(() => {
    if (isTest) return; // no cloning for tests

    fetch(`${API_BASE_URL}/api/courses/${courseId}/activities`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setActivities(Array.isArray(d) ? d : []))
      .catch(err => console.error('❌ Failed to load course activities:', err));
  }, [courseId, isTest]);

  const handleCloneGroups = async () => {
    if (!cloneFromActivityId) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/courses/${courseId}/activities/${cloneFromActivityId}/groups-config`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to load groups');
        return;
      }
      setGroups(data.groups || []);
    } catch (err) {
      console.error('❌ clone groups failed:', err);
      alert('Failed to clone groups');
    }
  };


  // Load students
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/courses/${courseId}/students`, { credentials: 'include' })

      .then(res => res.json())
      .then(data => {
        const loaded = Array.isArray(data) ? data : data.students;
        setStudents(loaded || []);

        // Initialize all students with role 'student' as selected
        const defaultSelected = {};
        (loaded || []).forEach(student => {
          defaultSelected[student.id] = student.role === 'student';
        });
        setSelected(defaultSelected);
      })
      .catch(err => console.error('❌ Failed to load students:', err));
  }, [courseId, activityId]);

  // NEW: load activity meta and inspect sheet for \test
  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activities/${activityId}`, {
          credentials: 'include'
        });

        if (!res.ok) return;

        const data = await res.json();

        setIsTest(data.is_test === 1);
      } catch (err) {
        console.error('❌ Failed to load activity meta:', err);
      }
    }

    if (activityId) fetchActivity();
  }, [activityId]);



  // NEW: when this is a test, default to groups-of-1 and no roles
  useEffect(() => {
    if (isTest) {
      setGroupSize(1);
      setUseRoles(false);
    }
  }, [isTest]);

  const toggleSelect = (id) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const generateGroups = () => {
    const present = students.filter(s => selected[s.id]);
    const shuffled = [...present].sort(() => Math.random() - 0.5);

    if (shuffled.length === 0) {
      setGroups([]);
      return;
    }

    const size = Math.min(Math.max(groupSize, 1), 5); // clamp 1–5

    // Split into groups of chosen size
    const rawGroups = [];
    for (let i = 0; i < shuffled.length; i += size) {
      rawGroups.push(shuffled.slice(i, i + size));
    }

    // Keep your special merge behavior ONLY for size 4 (your previous logic)
    if (size === 4 && rawGroups.length > 0) {
      const lastGroup = rawGroups[rawGroups.length - 1];

      if (lastGroup.length === 1 && rawGroups.length >= 3) {
        const merged = rawGroups.splice(-3).flat();
        rawGroups.push(
          merged.slice(0, 3),
          merged.slice(3, 6),
          merged.slice(6)
        );
      } else if (lastGroup.length === 2 && rawGroups.length >= 2) {
        const merged = rawGroups.splice(-2).flat();
        rawGroups.push(
          merged.slice(0, 3),
          merged.slice(3)
        );
      }
    }

    if (size === 3 && rawGroups.length >= 2) {
      const last = rawGroups[rawGroups.length - 1];

      // If we ended with a single student (e.g., 25 → …, 3, 1)
      if (last.length === 1) {
        const one = rawGroups.pop();      // [1]
        const three = rawGroups.pop();    // [3]

        const merged = [...three, ...one]; // total 4
        rawGroups.push(merged.slice(0, 2));
        rawGroups.push(merged.slice(2, 4));
      }
    }
    const rolePriority = ['facilitator', 'analyst', 'qc', 'spokesperson'];

    const finalGroups = rawGroups.map(group => {
      const gSize = group.length;

      const members = group.map((student, index) => {
        let role = null; // default: no role

        if (useRoles) {
          if (gSize < 4) {
            // Fill roles in priority order for however many students there are
            role = rolePriority[index] || null;
          } else if (gSize === 4) {
            role = rolePriority[index] || null;
          } else {
            // gSize === 5: first 4 get roles, 5th gets none
            role = index < 4 ? rolePriority[index] : null;
          }
        }

        return {
          student_id: student.id,
          role
        };
      });

      return { members };
    });

    console.log('🧩 Generated groups:', finalGroups);
    setGroups(finalGroups);
  };

  const handleSaveGroups = async () => {
    // TEST: no groups, no cloning; one instance per selected student
    if (isTest) {
      const selectedStudentIds = students
        .filter(s => selected[s.id] && s.role === 'student')
        .map(s => s.id);

      if (selectedStudentIds.length === 0) {
        alert('Select at least one student.');
        return;
      }
      if (!testStartAt) {
        alert('Please set the test start date and time.');
        return;
      }
      if (!testDurationMinutes || testDurationMinutes <= 0) {
        alert('Please set a positive time limit in minutes.');
        return;
      }

      const testStartAtUtc = new Date(testStartAt).toISOString();

      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/setup-groups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            activityId: Number(activityId),
            courseId: Number(courseId),

            // ✅ test path
            selectedStudentIds,
            testStartAt: testStartAtUtc,
            testDurationMinutes: Number(testDurationMinutes),
            lockedBeforeStart: !!lockedBeforeStart,
            lockedAfterEnd: !!lockedAfterEnd,
          })
        });

        const data = await res.json();
        if (!res.ok) {
          alert(`❌ Error: ${data.error || 'Failed to save test settings'}`);
          return;
        }

        alert('✅ Test instances created.');
        navigate(`/view-groups/${courseId}/${activityId}`);
      } catch (err) {
        console.error('❌ Save test failed:', err);
        alert('❌ Failed to save test.');
      }
      return;
    }

    // NON-TEST: old groups workflow
    if (!groups || groups.length === 0) {
      alert('Generate groups first.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/setup-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          activityId: Number(activityId),
          courseId: Number(courseId),
          groups,
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(`❌ Error: ${data.error || 'Failed to save groups'}`);
        return;
      }

      alert('✅ Groups saved successfully.');
      if (isTest) {
        navigate(`/view-tests/${courseId}/${activityId}`);
      } else {
        navigate(`/view-groups/${courseId}/${activityId}`);
      }
    } catch (err) {
      console.error('❌ Save groups failed:', err);
      alert('❌ Failed to save groups.');
    }
  };

  return (
    <Container className="mt-4">
      <h2>{isTest ? 'Test Setup' : 'Group Setup'}</h2>


      {isTest && (
        <p className="text-muted">
          This activity is marked as a <strong>test</strong>.
          Each selected student will receive an individual timed instance.
        </p>
      )}


      <h5>Select Present Students:</h5>
      <Row>
        {Array.isArray(students) && students.length > 0 ? (
          students.map(s => (
            <Col md={3} key={s.id} className="mb-2">
              <Form.Check
                type="checkbox"
                label={s.role === 'student' ? s.name : `${s.name} (${s.role})`}
                checked={!!selected[s.id]}
                onChange={() => toggleSelect(s.id)}
              />
            </Col>
          ))
        ) : (
          <p>No students enrolled.</p>
        )}
      </Row>

      {/* Controls */}
      <Row className="mt-3">
        {!isTest && (
          <Col md={3}>
            <Form.Label>Group Size</Form.Label>
            <Form.Select
              value={groupSize}
              onChange={(e) => setGroupSize(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </Form.Select>
          </Col>
        )}

        {!isTest && (
          <Col md={3} className="d-flex align-items-end">
            <Form.Check
              type="checkbox"
              id="use-roles"
              label="Assign roles to group members"
              checked={useRoles}
              onChange={(e) => setUseRoles(e.target.checked)}
            />
          </Col>
        )}

        {/* Test timing controls */}
        {isTest && (
          <>
            <Col md={3}>
              <Form.Label>Test start date &amp; time</Form.Label>
              <Form.Control
                type="datetime-local"
                value={testStartAt}
                onChange={(e) => setTestStartAt(e.target.value)}
              />
            </Col>
            <Col md={3}>
              <Form.Label>Time limit (minutes)</Form.Label>
              <Form.Control
                type="number"
                min={1}
                value={testDurationMinutes}
                onChange={(e) => setTestDurationMinutes(Number(e.target.value) || 0)}
              />
            </Col>
            <Col md={3} className="d-flex align-items-end">
              <Form.Check
                type="checkbox"
                id="locked-before-start"
                label="Lock before start time"
                checked={lockedBeforeStart}
                onChange={(e) => setLockedBeforeStart(e.target.checked)}
              />
            </Col>
            <Col md={3} className="d-flex align-items-end">
              <Form.Check
                type="checkbox"
                id="locked-after-end"
                label="Lock after end of test"
                checked={lockedAfterEnd}
                onChange={(e) => setLockedAfterEnd(e.target.checked)}
              />
            </Col>
          </>
        )}
      </Row>
      {!isTest && (<Row className="mt-3">
        <Col md={6}>
          <Form.Label>Clone groups from another activity (same course)</Form.Label>
          <Form.Select
            value={cloneFromActivityId}
            onChange={(e) => setCloneFromActivityId(e.target.value)}
          >
            <option value="">-- Select an activity --</option>
            {activities
              .filter(a => a.has_groups && a.activity_id !== Number(activityId))
              .map(a => (
                <option key={a.activity_id} value={a.activity_id}>
                  {a.title || a.activity_name || `Activity ${a.activity_id}`}
                </option>
              ))}
          </Form.Select>
        </Col>
        <Col md="auto" className="d-flex align-items-end">
          <Button
            variant="secondary"
            disabled={!cloneFromActivityId}
            onClick={handleCloneGroups}
          >
            Clone Groups
          </Button>
        </Col>
      </Row>
      )}

      {!isTest && (
        <>
          <Button className="mt-3" onClick={generateGroups}>
            Generate Groups
          </Button>

          {groups.length > 0 && (
            <>
              <h5 className="mt-4">Generated Groups:</h5>
              {groups.map((group, idx) => (
                <Card key={idx} className="mb-3">
                  <Card.Header>Group {idx + 1}</Card.Header>
                  <Card.Body>
                    <ul>
                      {Array.isArray(group.members) && group.members.length > 0 ? (
                        group.members.map((m, i) => {
                          const student = students.find(s => s.id === m.student_id);
                          const name = student?.name || 'Unknown';
                          return <li key={i}>{m.role ? `${m.role}: ${name}` : name}</li>;
                        })
                      ) : (
                        <li>No members in this group.</li>
                      )}
                    </ul>
                  </Card.Body>
                </Card>
              ))}
            </>
          )}
        </>
      )}
      <Button className="mt-3" onClick={handleSaveGroups}>
        Save
      </Button>
    </Container>
  );
}
