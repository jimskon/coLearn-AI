const express = require('express');
const router = express.Router();
const controller = require('./controller');

router.get('/statuses', controller.getProgressMonitorBoard);
router.patch('/suggestions/:id', controller.updateProgressMonitorSuggestion);

module.exports = router;
