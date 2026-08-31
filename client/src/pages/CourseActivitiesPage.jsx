// src/pages/CourseActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Table, Button, ButtonGroup, Spinner, Alert, Badge } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

const TYPE_LABELS = {
  group: 'Group',
  test: 'Test',
  demo: 'Demo',
  playground: 'Playground',
  assignment: 'Assignment',
};

const TYPE_BADGE_VARIANTS = {
  group: 'secondary',
  test: 'warning',
  demo: 'info',
  playground: 'info',
  assignment: 'success',
};


export default function CourseActivitiesPage() {
  const { courseId } = useParams();
  const location = useLocation();
  const courseName = location.state?.courseName;
  const navigate = useNavigate();

  const [activities, setActivities] = useState([]);
  const [courseInfo, setCourseInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useUser();

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const [activitiesRes, courseInfoRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/courses/${courseId}/activities`, {
            credentials: 'include',
          }),
          fetch(`${API_BASE_URL}/api/courses/${courseId}/info`, {
            credentials: 'include',
          }),
        ]);

        if (!activitiesRes.ok) throw new Error(`HTTP ${activitiesRes.status}`);
        if (!courseInfoRes.ok) throw new Error(`HTTP ${courseInfoRes.status}`);

        const data = await activitiesRes.json();
        const courseInfoData = await courseInfoRes.json();
        setActivities(Array.isArray(data) ? data : []);
        setCourseInfo(courseInfoData || null);
      } catch (err) {
        console.error('❌ Failed to fetch activities:', err);
        setError('Unable to load activities.');
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();
  }, [courseId]);

  const isDemoClass = Boolean(courseInfo?.class_demo_mode);
  const isDemoInstructor = user?.demo_mode === 'instructor';

  const ensureDemoInstance = async (activity) => {
    const res = await fetch(
      `${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activity.activity_id}/demo-instance`,
      {
        method: 'POST',
        credentials: 'include',
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.instanceId) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    return Number(data.instanceId);
  };

  const handleDoActivity = async (activity, isInstructor = false) => {
    const activityId = activity.activity_id;
    const activityType =
      activity.activity_type
      || activity.authored_mode
      || (activity.is_test === 1 ? 'test' : 'group');
    const isTest = activityType === 'test';
    const isDemo = activityType === 'demo';
    const isPlayground = activityType === 'playground';
    const isDemoLike = isDemo || isPlayground;
    const isDemoClassGroup = isDemoClass && !isTest && !isDemoLike;
    let instanceId = activity.instance_id;

    if (isDemoLike) {
      try {
        instanceId = await ensureDemoInstance(activity);
        setActivities((prev) =>
          prev.map((a) =>
            a.activity_id === activity.activity_id
              ? { ...a, instance_id: instanceId, has_groups: true }
              : a
          )
        );
      } catch (err) {
        console.error('❌ Failed to open demo:', err);
        alert(err?.message || 'Unable to open demo.');
        return;
      }
    }

    if (!isInstructor && isDemoClassGroup && !instanceId) {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/groups/${activityId}/${courseId}/smart-add`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ studentId: user?.id }),
          }
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.activityInstanceId) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }

        instanceId = Number(data.activityInstanceId);
        setActivities((prev) =>
          prev.map((a) =>
            a.activity_id === activity.activity_id
              ? { ...a, instance_id: instanceId, has_groups: true }
              : a
          )
        );
      } catch (err) {
        console.error('❌ Failed to auto-place student in demo group:', err);
        alert(err?.message || 'Unable to join a demo group.');
        return;
      }
    }

    const path = isInstructor
      ? (isTest
        ? `/test-setup/${courseId}/${activityId}`   // ✅ tests go here
        : isDemoLike
          ? `/run/${instanceId}`
          : isDemoClassGroup
            ? `/view-groups/${courseId}/${activityId}`
            : `/setup-groups/${courseId}/${activityId}` // ✅ non-tests go here
      )
      : `/run/${instanceId}`;

    navigate(path, { state: { courseName } });
  };
  const toggleHidden = async (activity) => {
    const newHidden = !activity.hidden;

    const url = `${API_BASE_URL}/api/courses/${courseId}/activities/${activity.activity_id}/hidden`;
    console.log('[HIDE] url:', url, 'newHidden:', newHidden);

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hidden: newHidden }),
      });

      console.log('[HIDE] status:', res.status);

      const txt = await res.text();           // <-- don’t assume JSON
      console.log('[HIDE] body head:', txt.slice(0, 200));

      if (!res.ok) {
        alert(`Failed: HTTP ${res.status}`);
        return;
      }

      // only if OK:
      setActivities((prev) =>
        prev.map((a) =>
          a.activity_id === activity.activity_id ? { ...a, hidden: newHidden } : a
        )
      );
    } catch (e) {
      console.error('[HIDE] fetch failed:', e);
      alert(`Fetch failed: ${e.message}`);
    }
  };

  const copyStudentLaunchLink = async (activity) => {
    const launchUrl = `${window.location.origin}/launch/${courseId}/${activity.activity_id}`;
    try {
      await navigator.clipboard.writeText(launchUrl);
      alert('Student launch link copied.');
    } catch (_err) {
      window.prompt('Copy this student launch link:', launchUrl);
    }
  };



  const isInstructorLike =
    user?.role === 'instructor' || user?.role === 'root' || user?.role === 'creator';

  return (
    <Container className="mt-4">
      <h2>{courseName ? `Instance: ${courseName}` : 'Available Activities'}</h2>

      {isDemoInstructor ? (
        <Alert variant="info" className="mt-3">
          Demo instructor mode: use <strong>View Groups</strong> to open the live class for an activity.
        </Alert>
      ) : null}

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : activities.length === 0 ? (
        <Alert variant="info">No activities available for this instance.</Alert>
      ) : (
        <Table striped bordered hover>
          <thead>
            <tr>
              <th>Activity Title</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity) => {
              const title = activity.title || activity.activity_name || 'Untitled Activity';
              const activityType =
                activity.activity_type
                || activity.authored_mode
                || (activity.is_test === 1 ? 'test' : 'group');
              const displayType = activity.authored_mode || activityType;
              const isTest = activityType === 'test';
              const isDemo = activityType === 'demo';
              const isPlayground = activityType === 'playground';
              const isDemoLike = isDemo || isPlayground;
              const isDemoClassGroup = isDemoClass && !isTest && !isDemoLike;
              const setupLabel = isDemoLike ? (isPlayground ? 'Open Playground' : 'Open Demo') : isDemoClassGroup ? 'Live Groups' : 'Setup Groups';
              const viewLabel = isDemoLike ? (isPlayground ? 'View Playground' : 'View Demo') : 'View Groups';
              const typeLabel = TYPE_LABELS[displayType] || TYPE_LABELS[activityType] || 'Group';
              const typeVariant = TYPE_BADGE_VARIANTS[displayType] || TYPE_BADGE_VARIANTS[activityType] || 'secondary';

              return (
                <tr key={activity.activity_id}>
                  <td>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span>{title}</span>
                      <Badge bg={typeVariant}>{typeLabel}</Badge>
                    </div>
                  </td>
                  <td>
                    {user?.role === 'student' && (activity.instance_id || isDemoLike || isDemoClassGroup) && !activity.hidden ? (

                      (() => {
                        const status = activity.student_status;

                        let label = isDemoLike ? (isPlayground ? 'Open Playground' : 'Open Demo') : isDemoClassGroup ? 'Join Demo Group' : 'Start';
                        let variant = 'success';

                        if (isDemoLike) {
                          variant = 'secondary';
                        } else if (status === 'in_progress') {
                          label = 'Resume';
                          variant = 'warning';
                        } else if (status === 'complete') {
                          label = 'Review';
                          variant = 'primary';
                        }

                        return (
                          <Button
                            variant={variant}
                            onClick={() => handleDoActivity(activity)}
                          >
                            {label}
                          </Button>
                        );
                      })()
                    ) : isInstructorLike ? (
                      <ButtonGroup>
                        <Button
                          variant="outline-secondary"
                          onClick={() => copyStudentLaunchLink(activity)}
                          title="Copy a login-aware link for WordPress or Moodle"
                        >
                          Copy Student Link
                        </Button>
                        {
                          isTest ? (
                            !activity.has_groups ? (
                              <Button
                                variant="primary"
                                onClick={() =>
                                  navigate(`/test-setup/${courseId}/${activity.activity_id}`, {
                                    state: { courseName },
                                  })
                                }
                              >
                                Setup Tests
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  navigate(`/view-tests/${courseId}/${activity.activity_id}`, {
                                    state: { courseName },
                                  })
                                }
                              >
                                View Tests
                              </Button>)
                          ) : !activity.has_groups ? (
                            <Button
                              variant="primary"
                              onClick={() => handleDoActivity(activity, true)}
                            >
                              {setupLabel}
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  isDemoLike
                                    ? handleDoActivity(activity, true)
                                    : navigate(`/view-groups/${courseId}/${activity.activity_id}`, {
                                        state: { courseName },
                                      })
                                }
                              >
                                {viewLabel}
                              </Button>

                              {/* 🔒 Hide only if groups exist */}
                              <Button
                                variant={activity.hidden ? 'success' : 'outline-danger'}
                                onClick={() => toggleHidden(activity)}
                              >
                                {activity.hidden ? 'Unhide' : 'Hide'}
                              </Button>
                            </>
                          )
                        }
                      </ButtonGroup>
                    ) : (
                      <span>Not available</span>
                    )}


                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Container>
  );
}
