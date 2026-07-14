const express = require('express');
const { getRuntimeFeatureConfig } = require('../utils/runtimeFeatures');

const router = express.Router();

router.get('/config', (_req, res) => {
  res.json(getRuntimeFeatureConfig());
});

module.exports = router;
