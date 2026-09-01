const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const classController = require('./controller');


// Get all classes
router.get('/', classController.getAllClasses);

// Create a new class
router.post('/', classController.createClass);

// Enrollment related
router.get('/user/:userId/enrollments', classController.getUserEnrollments);
router.post('/enroll-by-code', classController.enrollByCode);

// Update a class
router.put('/:id', classController.updateClass);

// Delete a class
router.delete('/:id', classController.deleteClass);

// ✅ Activities for a class
router.get('/:id/activities', classController.getActivitiesByClass);
router.post('/:id/activities', classController.createActivityForClass);
router.post('/:id/activities/import-google-export', requireAuth, classController.importGoogleExportMapping);
router.post('/:id/activities/replace-bundle', requireAuth, classController.replaceActivitiesBundle);
router.post('/:id/creator-draft', classController.createCreatorDraft);
router.post('/:id/creator-draft/:activityId/revise', classController.reviseCreatorDraft);
router.post('/:id/creator-draft/:activityId/revise-question', classController.reviseCreatorQuestion);
router.put('/:id/activities/:activityName', classController.updateActivityForClass);
router.delete('/:classId/activities/:activityId', classController.deleteActivityFromClass);

// ✅ NEW: Get single class info
router.get('/:id', classController.getClassById);

// ✅ NEW: Import activities from a folder
router.post('/:id/import-folder', requireAuth, classController.importFolderActivities);
router.post('/:id/import-google', requireAuth, classController.importGoogleActivities);


module.exports = router;
