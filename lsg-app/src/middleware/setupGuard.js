/**
 * setupGuard.js
 *
 * Global middleware that blocks all API routes until first-run setup is complete.
 * When SETUP_COMPLETE !== 'true', only /api/setup/* and /api/health pass through.
 *
 * This middleware runs after routes are mounted.  It is inserted in routes/index.js
 * BEFORE all protected route groups.
 */

'use strict';

// Routes that must always be accessible regardless of setup state
const ALWAYS_ALLOWED_PREFIXES = [
    '/setup',   // first-run setup wizard endpoints
    '/health',  // liveness probe
];

function setupGuard(req, res, next) {
    // If setup is complete, let all requests through
    if (process.env.SETUP_COMPLETE === 'true') {
        return next();
    }

    // Allow whitelisted prefixes (relative to /api mount point)
    const relPath = req.path; // e.g. "/setup/status", "/health"
    const allowed = ALWAYS_ALLOWED_PREFIXES.some(prefix => relPath.startsWith(prefix));
    if (allowed) {
        return next();
    }

    return res.status(503).json({
        success: false,
        code: 'SETUP_REQUIRED',
        message: 'Initial device setup is not complete. Please visit the setup page to configure the device.',
    });
}

module.exports = setupGuard;
