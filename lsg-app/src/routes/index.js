/**
 * Main Router Configuration
 * Configures and exports the main Express router with all route groups
 * @module routes/index
 */

const express = require('express');
const router = express.Router();
const redpandaRoutes = require('./redpanda.routes');
const networkRoutes = require('./network');
const systemRoutes = require('./systemRoutes');
const systemRoutes2 = require('./system.routes');
const protocolRoutes = require('./protocol.routes');
const authRoutes = require('./auth.routes');
const registryRoutes = require('./registry.routes');
const setupRoutes = require('./setup.routes');
const servicesRoutes = require('./services.routes');
const setupGuard = require('../middleware/setupGuard');

/**
 * @route GET /api/health
 * @description Health check endpoint to verify API status
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// ── Setup routes (always available — no auth, no setup guard) ─────────────────
// Must be mounted BEFORE setupGuard so the wizard can call these endpoints
// even when SETUP_COMPLETE=false.
router.use('/setup', setupRoutes);

// ── Global setup guard — blocks everything below until SETUP_COMPLETE=true ────
router.use(setupGuard);

// ── Protected route groups ────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/redpanda', redpandaRoutes);
router.use('/network', networkRoutes);
router.use('/remote-management', systemRoutes);
router.use('/polling', protocolRoutes);
router.use('/system', systemRoutes2);
router.use('/system', require('./onboarding.routes'));
router.use('/system/remote', require('./remote.routes'));
router.use('/registry', registryRoutes);
router.use('/services', servicesRoutes);

module.exports = router; 