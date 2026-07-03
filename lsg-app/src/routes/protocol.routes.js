const express = require('express');
const router = express.Router();
const jwtAuth = require('../middleware/jwtAuth');
const systemCheckMiddleware = require('../middleware/systemCheckMiddleware');
const {
    listProtocols,
    installProtocol,
    uninstallProtocol,
    getProtocolStatus,
    getUninstallStatus,
    restartProtocol,
    startProtocol,
    stopProtocol,
    updateCsvConfig,
    updateParameters,
    getConfigurations,
    getProtocolLogs
} = require('../controllers/protocol.controller');

router.use(jwtAuth);
// Apply system check middleware to all protocol routes
router.use(systemCheckMiddleware);

// Protocol management routes
router.get('/protocols', listProtocols);
router.post('/protocols/install', installProtocol);
router.delete('/protocols/:protocol', uninstallProtocol);
router.get('/protocols/:protocol/status', getProtocolStatus);
router.get('/protocols/:protocol/uninstall-status', getUninstallStatus);
router.post('/protocols/:protocol/restart', restartProtocol);
router.post('/protocols/:protocol/start', startProtocol);
router.post('/protocols/:protocol/stop', stopProtocol);

// Logs route
router.get('/protocols/:protocol/logs', getProtocolLogs);

// Config routes for any protocol (replaces old opcua-only routes)
router.post('/protocols/:protocol/config/csv', updateCsvConfig);
router.post('/protocols/:protocol/config/parameters', updateParameters);
router.get('/protocols/:protocol/config', getConfigurations);

module.exports = router;
