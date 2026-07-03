/**
 * setup.routes.js — First-run device setup endpoints
 *
 * GET  /api/setup/status   — always available, no auth
 *   Returns { configured: bool }
 *
 * POST /api/setup/complete — only works when SETUP_COMPLETE != 'true'
 *   Accepts user-provided secrets, writes + re-encrypts secrets.env.age,
 *   then triggers a service restart.
 *
 * Architecture note (future re-configuration):
 *   To allow an authenticated admin to re-run setup (e.g. rotate secrets),
 *   add the following check BEFORE the isConfigured() guard:
 *
 *     const jwtAuth = require('../middleware/jwtAuth');
 *     router.post('/complete', (req, res, next) => {
 *       if (setupService.isConfigured()) {
 *         return jwtAuth(req, res, next);   // require login for re-config
 *       }
 *       next();                             // first-time: no auth needed
 *     }, completeSetup);
 *
 *   No changes to setupService.js are needed for that extension.
 */

'use strict';

const express = require('express');
const router = express.Router();
const setupService = require('../services/setupService');

// ── GET /api/setup/status ─────────────────────────────────────────────────────
router.get('/status', (req, res) => {
    res.json({ configured: setupService.isConfigured() });
});

// ── POST /api/setup/verify-token ─────────────────────────────────────────────
router.post('/verify-token', (req, res) => {
    if (setupService.isConfigured()) {
        return res.status(403).json({
            success: false,
            code: 'ALREADY_CONFIGURED',
            message: 'Device is already configured.',
        });
    }
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, message: 'Token is required.' });
    }
    const expected = setupService.getSetupToken();
    if (!expected) {
        return res.status(500).json({
            success: false,
            message: 'Setup token not found on device. Reinstall the service.',
        });
    }
    if (token !== expected) {
        return res.status(401).json({
            success: false,
            code: 'INVALID_TOKEN',
            message: 'Invalid setup token.',
        });
    }
    res.json({ success: true });
});

// ── POST /api/setup/complete ──────────────────────────────────────────────────
router.post('/complete', async (req, res) => {
    // Guard: only allow setup when not yet configured
    // (see architecture note above for future re-config support)
    if (setupService.isConfigured()) {
        return res.status(403).json({
            success: false,
            code: 'ALREADY_CONFIGURED',
            message: 'Device is already configured. Setup cannot be run again.',
        });
    }

    // Validate the one-time setup token sent by the browser wizard
    const providedToken = req.headers['x-setup-token'];
    const expectedToken = setupService.getSetupToken();
    if (!expectedToken) {
        return res.status(500).json({
            success: false,
            message: 'Setup token not found on device. Reinstall the service.',
        });
    }
    if (!providedToken || providedToken !== expectedToken) {
        return res.status(401).json({
            success: false,
            code: 'INVALID_TOKEN',
            message: 'Invalid or missing setup token.',
        });
    }

    const {
        adminUsername,
        adminPassword,
        confirmPassword,
        githubToken,
        masterMqttHost,
        masterMqttPort,
        masterMqttUsername,
        masterMqttPassword,
        apiKeys,
    } = req.body;

    // Validate password confirmation client-side too, but double-check server-side
    if (!adminPassword || adminPassword !== confirmPassword) {
        return res.status(400).json({
            success: false,
            code: 'PASSWORD_MISMATCH',
            message: 'Passwords do not match.',
        });
    }

    if (adminPassword.length < 8) {
        return res.status(400).json({
            success: false,
            code: 'PASSWORD_TOO_SHORT',
            message: 'Password must be at least 8 characters.',
        });
    }

    try {
        await setupService.writeSecrets({
            adminUsername,
            adminPassword,
            githubToken,
            masterMqttHost,
            masterMqttPort,
            masterMqttUsername,
            masterMqttPassword,
            apiKeys,
        });

        // Respond before restarting so the client receives the success message
        res.json({
            success: true,
            message: 'Setup complete. Service is restarting — this takes a few seconds.',
        });

        // Restart after response is sent
        setupService.restartService();
    } catch (error) {
        console.error('[Setup] Setup completion failed:', error.message);
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
});

module.exports = router;
