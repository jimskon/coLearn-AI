const express = require('express');
const router = express.Router();
const controller = require('./controller');

// POST /api/responses
router.post('/', controller.createResponse);

// GET responses for all members in the instance's group (no group_id field)
router.get('/:instanceId/group', controller.getGroupResponses);

// Optional: keep if you still use this route format, else remove
// router.get('/:instanceId/:groupId', controller.getGroupResponses);
router.post('/code', controller.createOrUpdateCodeResponse);

router.post('/bulk-save', controller.bulkSaveResponses);

router.post('/save-feedback', controller.saveFeedback); // ✅ Add this line

router.post('/mark-complete', controller.markActivityInstanceComplete);


module.exports = router;
