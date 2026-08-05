// server/activity_instances/routes.js
const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Clear ALL answers for a group (activity instance)
router.delete('/:instanceId/responses', controller.clearResponsesForInstance);
// Permanently remove an instance and its members, drafts, responses, and feedback.
router.delete('/:instanceId', controller.deleteActivityInstance);

// ✅ Create a new activity instance
router.post('/', controller.createActivityInstance);

// ✅ Create multiple group-based instances
router.post('/setup-groups', controller.setupMultipleGroupInstances);
router.post('/by-activity/:courseId/:activityId/demo-instance', controller.ensureDemoInstance);
router.post('/by-activity/:activityId/sandbox-instance', controller.ensureActivitySandboxInstance);

// ✅ Reopen a timed test window for this instance
router.post('/:instanceId/reopen', controller.reopenInstance);

// ✅ Regrade this test instance using stored answers
//router.post('/:instanceId/regrade', controller.regradeTestInstance);

router.post('/:instanceId/test-settings', controller.updateTestSettings);

// ✅ Submit a test for this instance
router.post('/:instanceId/submit-test', controller.submitTest);   
// Assignment labs use the same scoring pipeline, but keep a distinct public
// endpoint so callers do not need to represent a lab as a test.
router.post('/:instanceId/submit-assignment', controller.submitTest);

// ✅ Get activity instance details
router.get('/:id', controller.getActivityInstanceById);

// ✅ Get parsed lines from activity sheet
router.get('/:instanceId/preview-doc', controller.getParsedActivityDoc);

// ✅ Get students enrolled in the course for the activity instance
router.get('/:id/enrolled-students', controller.getEnrolledStudents);

// ✅ Record student heartbeat for presence
router.post('/:instanceId/heartbeat', controller.recordHeartbeat);

// ✅ Get active student for an activity instance (auto-assign if none)
router.get('/:instanceId/active-student', controller.getActiveStudent);

// ✅ Rotate to next active student
router.post('/:instanceId/rotate-active-student', controller.rotateActiveStudent);

// ✅ Submit group answers for a question group
router.post('/:instanceId/submit-group', controller.submitGroupResponses);

// ✅ Get full submit history for an activity instance
router.get('/:instanceId/responses/history', controller.getInstanceResponseHistory);

// ✅ Get all saved responses for a specific group in an instance
router.get('/:instanceId/responses', controller.getInstanceResponses);

// ✅ Get student group members in an activity instance
router.get('/:instanceId/groups', controller.getInstanceGroups);

// ✅ List all activity_instances for a given course + activity
router.get('/by-activity/:courseId/:activityId', controller.getInstancesForActivityInCourse);
router.delete('/by-activity/:courseId/:activityId/demo-roster', controller.clearDemoActivityRoster);
router.post('/by-activity/:courseId/:activityId/timer-pause', controller.setTimerPauseForActivity);
router.post('/by-activity/:courseId/:activityId/active-rotation-mode', controller.setActiveRotationModeForActivity);

// ✅ Refresh total_groups by parsing the linked Google Doc
router.get('/:instanceId/refresh-groups', controller.refreshTotalGroups);

router.post('/:instanceId/recompute-test-totals', controller.recomputeTestTotals);
router.post('/:instanceId/mark-reviewed', controller.markTestReviewed);



module.exports = router;
