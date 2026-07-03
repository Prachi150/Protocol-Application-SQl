const express = require('express');
const router = express.Router();
const { getSystemOverview, getAppUptime } = require('../controllers/system.controller');
const jwtAuth = require('../middleware/jwtAuth');

router.get('/overview', jwtAuth, getSystemOverview);
router.get('/uptime',   jwtAuth, getAppUptime);

module.exports = router; 