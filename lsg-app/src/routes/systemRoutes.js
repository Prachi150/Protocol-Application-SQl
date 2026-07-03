const express = require('express');
const router = express.Router();
const systemService = require('../services/systemService');
const scheduleService = require('../services/scheduleService');
const vpnRoutes = require('./vpnRoutes');
const jwtAuth = require('../middleware/jwtAuth');

router.use(jwtAuth);

// VPN management routes
router.use('/vpn', vpnRoutes);

// Get system time settings
router.get('/time', async (req, res) => {
    try {
        const timeSettings = await systemService.getSystemTime();
        res.json(timeSettings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update system time settings
router.put('/time', async (req, res) => {
    try {
        const config = req.body;
        const updatedSettings = await systemService.setSystemTime(config);
        res.json(updatedSettings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get available timezones
router.get('/time/zones', async (req, res) => {
    try {
        const timeSettings = await systemService.getSystemTime();
        res.json({ timezones: timeSettings.availableTimezones });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all restart schedules (both one-time and recurring)
router.get('/restart', async (req, res) => {
    try {
        const [oneTime, recurring] = await Promise.all([
            systemService.getScheduledRestarts(),
            scheduleService.listSchedules()
        ]);
        
        res.json({
            oneTime,
            recurring
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Schedule a restart (handles both immediate, one-time scheduled, and recurring)
router.post('/restart', async (req, res) => {
    try {
        const { type, ...options } = req.body;

        switch (type) {
            case 'immediate':
                const result = await systemService.restartSystem({ 
                    type,
                    force: options.force 
                });
                return res.json(result);

            case 'scheduled':
                const scheduledResult = await systemService.restartSystem({
                    type,
                    datetime: options.datetime,
                    allowActiveUsers: options.allowActiveUsers
                });
                return res.json(scheduledResult);

            case 'recurring':
                if (!options.schedule || !options.schedule.type || !options.schedule.value) {
                    return res.status(400).json({
                        error: 'Recurring schedule requires schedule.type and schedule.value'
                    });
                }
                const recurringResult = await scheduleService.addSchedule(
                    options.schedule.type,
                    options.schedule.value,
                    options.schedule.action
                );
                return res.json(recurringResult);

            default:
                return res.status(400).json({
                    error: 'Invalid restart type. Must be "immediate", "scheduled", or "recurring"'
                });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cancel a restart schedule (handles both one-time and recurring)
router.delete('/restart/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Try to cancel as recurring first
        try {
            const result = await scheduleService.removeSchedule(id);
            return res.json(result);
        } catch (error) {
            // If not found as recurring, try as one-time schedule
            const result = await systemService.cancelScheduledRestart(id);
            return res.json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List available scheduled task actions
router.get('/schedule/actions', (req, res) => {
    res.json(scheduleService.getActionCatalog());
});

module.exports = router; 