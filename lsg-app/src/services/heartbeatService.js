const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const configManager = require('./configManager');
const onboardingService = require('./onboardingService');

const execPromise = util.promisify(exec);

// Default interval: 60 seconds
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL) || 60000;

class HeartbeatService {
    constructor() {
        this.timer = null;
        this.running = false;
    }

    async start() {
        if (this.running) return;

        const config = await configManager.getConfig();
        if (!config.onboarding || config.onboarding.status !== 'onboarded') {
            console.log('[Heartbeat] Not onboarded yet, skipping heartbeat start');
            return;
        }

        this.running = true;
        console.log(`[Heartbeat] Starting heartbeat sender (every ${HEARTBEAT_INTERVAL / 1000}s)`);

        // Send first heartbeat immediately
        this.sendHeartbeat().catch(err => {
            console.error('[Heartbeat] Initial heartbeat failed:', err.message);
        });

        // Schedule periodic heartbeats
        this.timer = setInterval(() => {
            this.sendHeartbeat().catch(err => {
                console.error('[Heartbeat] Failed:', err.message);
            });
        }, HEARTBEAT_INTERVAL);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.running = false;
        console.log('[Heartbeat] Stopped');
    }

    async sendHeartbeat() {
        const config = await configManager.getConfig();
        const onboarding = config.onboarding;

        if (!onboarding || !onboarding.token || !onboarding.adminUrl) {
            return; // Not onboarded, nothing to send
        }

        const heartbeatData = await this.collectStats();

        // Prefer MQTT for heartbeat (works even when VPN fluctuates)
        const { publishMessage, isConnected } = require('./masterMqttClient');
        if (isConnected()) {
            publishMessage('lsg/' + onboarding.token + '/heartbeat', heartbeatData);
        } else {
            // Fallback to HTTP if MQTT is not connected
            await axios.post(`${onboarding.adminUrl}/api/lsg/public/heartbeat`, {
                token: onboarding.token,
                heartbeatData
            }, { timeout: 15000 });
        }
    }

    async collectStats() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const cpuUsage = await onboardingService.getCpuUsage();
        const diskInfo = await onboardingService.getDiskInfo();
        const networkConfig = onboardingService.getNetworkConfig();

        return {
            resourceOverview: {
                cpu: os.cpus().length,
                ram: Math.round(totalMem / (1024 * 1024 * 1024)),
                disk: diskInfo.totalGb,
                cpuUsage,
                ramUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
                diskUsage: diskInfo.usagePercent
            },
            uptime: onboardingService.formatUptime(os.uptime()),
            vpnIp: networkConfig.vpnIp || null,
            vpnStatus: networkConfig.vpnIp ? 'on' : 'off'
        };
    }
}

module.exports = new HeartbeatService();
