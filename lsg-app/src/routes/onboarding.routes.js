const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const onboardingService = require('../services/onboardingService');
const configManager = require('../services/configManager');
const heartbeatService = require('../services/heartbeatService');
const { INSTALL_DIR, uninstallApp } = require('../controllers/protocol.controller');
const jwtAuth = require('../middleware/jwtAuth');

router.use(jwtAuth);

/**
 * Get Onboarding Status
 * GET /api/system/onboard/status
 */
router.get('/onboard/status', async (req, res) => {
    try {
        const config = await configManager.getConfig();
        const onboarding = config.onboarding;

        if (onboarding && onboarding.status === 'onboarded') {
            res.json({
                onboarded: true,
                onboarding: {
                    adminUrl: onboarding.adminUrl,
                    connectionMode: onboarding.connectionMode,
                    onboardedAt: onboarding.onboardedAt,
                    status: onboarding.status
                }
            });
        } else {
            res.json({ onboarded: false });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Reset / Re-onboard — uninstalls all protocol apps and clears onboarding state
 * POST /api/system/onboard/reset
 */
router.post('/onboard/reset', async (req, res) => {
    try {
        const uninstalledApps = [];

        // 1. Scan apps/ directory and uninstall every installed app
        try {
            const dirs = await fs.readdir(INSTALL_DIR, { withFileTypes: true });
            for (const dir of dirs) {
                if (dir.isDirectory()) {
                    const appName = dir.name;
                    const appPath = path.join(INSTALL_DIR, appName);
                    try {
                        await uninstallApp(appName, appPath, appName);
                        uninstalledApps.push(appName);
                        console.log('[Reset] Uninstalled:', appName);
                    } catch (err) {
                        console.error('[Reset] Failed to uninstall', appName, ':', err.message);
                    }
                }
            }
        } catch (err) {
            // apps/ directory may not exist — that's fine
            if (err.code !== 'ENOENT') {
                console.error('[Reset] Error scanning apps dir:', err.message);
            }
        }

        // 2. Stop heartbeat
        heartbeatService.stop();

        // 3. Clear onboarding config
        const config = await configManager.getConfig();
        delete config.onboarding;
        await configManager.persistConfig();

        console.log('[Reset] Onboarding state cleared. Uninstalled apps:', uninstalledApps);
        res.json({ success: true, uninstalledApps });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Trigger Onboarding
 * POST /api/system/onboard
 */
router.post('/onboard', async (req, res) => {
    try {
        const { token, adminUrl } = req.body;

        if (!token) {
            return res.status(400).json({ success: false, message: 'Token is required' });
        }

        // adminUrl is optional — onboarding now uses MQTT, not HTTP
        const targetUrl = adminUrl || process.env.IOADMIN_URL || null;

        const result = await onboardingService.onboard(token, targetUrl);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
