// server/groups/routes.js
const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Existing route: get one group by activity instance
router.get('/instance/:id', controller.getGroupsByInstance);

// New live-edit routes
router.get('/:activityId/:courseId/available-students', controller.getAvailableStudents);
router.get('/:activityId/:courseId/active-students', controller.getActiveStudentsInActivity);
router.post('/:activityId/:courseId/smart-add', controller.smartAddStudent);
router.post('/:activityId/:courseId/add-solo', controller.addSoloStudent);

router.delete('/:activityInstanceId/remove/:studentId', controller.removeStudentFromGroup);

module.exports = router;
