const express = require('express');
const router = express.Router();
const controller = require('./controller');

// ---- POST routes ----

// Draft text response (single field)
router.post('/', controller.createResponse);

// Draft code response (with AI feedback)
router.post('/code', controller.createOrUpdateCodeResponse);

// Bulk draft save (main student typing path)
router.post('/bulk-save', controller.bulkSaveResponses);

// Feedback persistence (currently stubbed)
router.post('/save-feedback', controller.saveFeedback);

// Mark activity instance complete
router.post('/mark-complete', controller.markActivityInstanceComplete);

// ---- GET routes ----

// Group merged view
router.get('/:instanceId/group', controller.getGroupResponses);

// Instance latest view
router.get('/:instanceId', controller.getResponsesByInstanceId);

module.exports = router;