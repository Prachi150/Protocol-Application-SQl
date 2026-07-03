const express = require('express');
const router = express.Router();
const remoteActionService = require('../services/remoteActionService');
const jwtAuth = require('../middleware/jwtAuth');

router.use(jwtAuth);

/**
 * Remote Uninstall
 * POST /api/system/remote/uninstall
 */
router.post('/uninstall', async (req, res) => {
    try {
        const { toolId, appName } = req.body;
        const result = await remoteActionService.uninstallApp(toolId, appName);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Remote Rollback
 * POST /api/system/remote/rollback
 */
router.post('/rollback', async (req, res) => {
    try {
        const { toolId, appName, version } = req.body;
        const result = await remoteActionService.rollbackApp(toolId, appName, version);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
