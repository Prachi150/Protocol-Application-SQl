/**
 * Registry Routes
 * Exposes the App Registry data and on-demand health checks.
 *
 * All routes are JWT-protected.
 *
 * GET  /api/registry              — list all registry entries
 * GET  /api/registry/:appName     — get one entry
 * GET  /api/registry/:appName/health — on-demand health check
 *
 * @module routes/registry.routes
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwtAuth = require('../middleware/jwtAuth');
const appRegistry = require('../services/appRegistry');

// Protect all registry routes with JWT
router.use(jwtAuth);

/**
 * GET /api/registry
 * Returns all registered protocol apps.
 */
router.get('/', (req, res) => {
    const entries = appRegistry.getAll();
    res.json({
        count: Object.keys(entries).length,
        apps: entries
    });
});

/**
 * GET /api/registry/:appName
 * Returns one registry entry or 404 if not found.
 */
router.get('/:appName', (req, res) => {
    const entry = appRegistry.getEntry(req.params.appName);
    if (!entry) {
        return res.status(404).json({ error: `App '${req.params.appName}' not found in registry` });
    }
    res.json(entry);
});

/**
 * GET /api/registry/:appName/health
 * Proxies a health check request to the app's port and healthCheckPath.
 * Returns { healthy, statusCode, responseTime } or { healthy: false, error }.
 */
router.get('/:appName/health', async (req, res) => {
    const entry = appRegistry.getEntry(req.params.appName);
    if (!entry) {
        return res.status(404).json({ error: `App '${req.params.appName}' not found in registry` });
    }

    const healthUrl = `http://127.0.0.1:${entry.port}${entry.healthCheckPath || '/health'}`;
    const start = Date.now();

    try {
        const response = await axios.get(healthUrl, { timeout: 3000 });
        res.json({
            healthy: true,
            statusCode: response.status,
            responseTime: Date.now() - start,
            url: healthUrl
        });
    } catch (err) {
        res.json({
            healthy: false,
            error: err.code || err.message,
            responseTime: Date.now() - start,
            url: healthUrl
        });
    }
});

module.exports = router;
