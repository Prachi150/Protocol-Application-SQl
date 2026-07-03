const express = require('express');
const router = express.Router();
const vpnService = require('../services/vpnService');
const { asyncHandler, createError } = require('../utils/errorHandler');

// Get VPN status
router.get('/status', asyncHandler(async (req, res) => {
    const status = await vpnService.getStatus();
    res.json(status);
}));

// Configure VPN profile
router.post('/profile', asyncHandler(async (req, res) => {
    const { signedUrl, profileName } = req.body;

    if (!signedUrl || !profileName) {
        throw createError('Missing required fields: signedUrl and profileName are required', 400);
    }

    const result = await vpnService.downloadAndSetupProfile(signedUrl, profileName);
    res.json(result);
}));

// Upload VPN profile directly (content as text)
router.post('/upload', asyncHandler(async (req, res) => {
    const { ovpnContent, profileName } = req.body;

    if (!ovpnContent || !profileName) {
        throw createError('Missing required fields: ovpnContent and profileName are required', 400);
    }

    const result = await vpnService.setupProfileFromContent(ovpnContent, profileName);
    res.json(result);
}));

// Enable/Disable VPN
router.post('/toggle', asyncHandler(async (req, res) => {
    const { enable } = req.body;

    if (typeof enable !== 'boolean') {
        throw createError('Missing or invalid field: enable (boolean) is required', 400);
    }

    const result = enable ? await vpnService.enable() : await vpnService.disable();
    res.json(result);
}));

// Enable/Disable global routing through VPN
router.post('/routing', asyncHandler(async (req, res) => {
    const { enable } = req.body;

    if (typeof enable !== 'boolean') {
        throw createError('Missing or invalid field: enable (boolean) is required', 400);
    }

    const result = await vpnService.setGlobalRouting(enable);
    res.json(result);
}));

module.exports = router; 