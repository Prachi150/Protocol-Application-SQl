const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const configManager = require('./configManager');
const execPromise = util.promisify(exec);

class OnboardingService {
    constructor() {}

    async getSystemInfo() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const diskInfo = await this.getDiskInfo();

        // Basic Info
        const info = {
            systemInformation: {
                os: `${os.type()} ${os.release()} (${os.arch()})`,
                processor: cpus[0].model,
                installedRam: `${Math.round(totalMem / (1024 * 1024 * 1024))} GB`,
                storage: diskInfo.total,
                uptime: this.formatUptime(os.uptime())
            },
            resourceOverview: {
                cpu: cpus.length,
                ram: Math.round(totalMem / (1024 * 1024 * 1024)),
                disk: diskInfo.totalGb,
                cpuUsage: await this.getCpuUsage(),
                ramUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
                diskUsage: diskInfo.usagePercent,
                gpuUsage: null // Placeholder
            },
            networkConfig: {
                ...this.getNetworkConfig(),
                sshUsername: os.userInfo().username
            }
        };

        return info;
    }

    formatUptime(seconds) {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    }

    async getCpuUsage() {
        // Simple CPU usage calculation
        const start = os.cpus();
        await new Promise(resolve => setTimeout(resolve, 100));
        const end = os.cpus();
        
        let idle = 0;
        let total = 0;
        
        for (let i = 0; i < start.length; i++) {
            const cpu1 = start[i];
            const cpu2 = end[i];
            
            const idleDiff = cpu2.times.idle - cpu1.times.idle;
            const totalDiff = Object.values(cpu2.times).reduce((a, b) => a + b) - Object.values(cpu1.times).reduce((a, b) => a + b);
            
            idle += idleDiff;
            total += totalDiff;
        }
        
        return Math.round(100 - ((idle / total) * 100));
    }

    getNetworkConfig() {
        const interfaces = os.networkInterfaces();
        let publicIp = null;
        let privateIp = null;
        let vpnIp = null;

        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    // VPN tunnel interfaces (tun0, tun1, etc.)
                    if (name.startsWith('tun')) {
                        vpnIp = iface.address;
                        continue;
                    }
                    if (this.isPrivateIp(iface.address)) {
                        privateIp = iface.address;
                    } else {
                        publicIp = iface.address;
                    }
                }
            }
        }

        return {
            publicIp: publicIp || 'Unknown',
            privateIp: privateIp || '127.0.0.1',
            ip: privateIp,
            vpnIp: vpnIp || null,
            lsgPort: parseInt(process.env.PORT) || 3001
        };
    }

    isPrivateIp(ip) {
        return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip);
    }

    async getDiskInfo() {
        try {
            // Get total size, used, available, and usage % for root filesystem
            const { stdout } = await execPromise("df -h / | tail -1 | awk '{print $2, $3, $4, $5}'");
            const parts = stdout.trim().split(/\s+/);
            const total = parts[0] || 'Unknown'; // e.g. "50G"
            const used = parts[1] || 'Unknown';
            const available = parts[2] || 'Unknown';
            const usagePercent = parseInt((parts[3] || '0').replace('%', '')) || 0;

            // Parse total to GB number
            let totalGb = 0;
            const match = total.match(/([\d.]+)([TGMK]?)/i);
            if (match) {
                const val = parseFloat(match[1]);
                const unit = (match[2] || '').toUpperCase();
                if (unit === 'T') totalGb = Math.round(val * 1024);
                else if (unit === 'G') totalGb = Math.round(val);
                else if (unit === 'M') totalGb = Math.round(val / 1024);
                else totalGb = Math.round(val);
            }

            return {
                total: `${total} (${used} used, ${available} free)`,
                totalGb,
                usagePercent
            };
        } catch (e) {
            return { total: 'Unknown', totalGb: 0, usagePercent: 0 };
        }
    }

    async getDiskUsage() {
        const info = await this.getDiskInfo();
        return info.usagePercent;
    }

    async installSshPublicKey(publicKey, targetUsername) {
        const keyLine = publicKey.trim();

        // Always install to process owner's home (backward compat)
        this._installKeyToDir(os.homedir(), keyLine);

        // If a target username is specified, also install to that user's home
        if (targetUsername) {
            try {
                const { stdout } = await execPromise('eval echo ~' + targetUsername);
                const targetHome = stdout.trim();
                if (targetHome && targetHome !== os.homedir() && fs.existsSync(path.dirname(targetHome))) {
                    this._installKeyToDir(targetHome, keyLine);
                    // Fix ownership (lsg-app runs as root on industrial PCs)
                    if (process.getuid && process.getuid() === 0) {
                        await execPromise('chown -R ' + targetUsername + ':' + targetUsername + ' ' + path.join(targetHome, '.ssh'));
                    }
                    console.log('[Onboarding] SSH key installed for user:', targetUsername);
                }
            } catch (err) {
                console.error('[Onboarding] Failed to install SSH key for user ' + targetUsername + ':', err.message);
            }
        }
    }

    _installKeyToDir(homeDir, keyLine) {
        const sshDir = path.join(homeDir, '.ssh');
        const authKeysPath = path.join(sshDir, 'authorized_keys');

        if (!fs.existsSync(sshDir)) {
            fs.mkdirSync(sshDir, { mode: 0o700 });
        }

        if (fs.existsSync(authKeysPath)) {
            const existing = fs.readFileSync(authKeysPath, 'utf8');
            if (existing.includes(keyLine)) {
                return;
            }
        }

        fs.appendFileSync(authKeysPath, keyLine + '\n', { mode: 0o600 });
        fs.chmodSync(authKeysPath, 0o600);
    }

    /**
     * Uninstall all installed protocol apps and clear onboarding state.
     * Called during re-onboarding to start clean.
     */
    async resetApps() {
        const { INSTALL_DIR, uninstallApp } = require('../controllers/protocol.controller');
        const fsPromises = require('fs').promises;

        try {
            const dirs = await fsPromises.readdir(INSTALL_DIR, { withFileTypes: true });
            for (const dir of dirs) {
                if (dir.isDirectory()) {
                    const appPath = path.join(INSTALL_DIR, dir.name);
                    try {
                        await uninstallApp(dir.name, appPath, dir.name);
                        console.log('[Reset] Uninstalled:', dir.name);
                    } catch (err) {
                        console.error('[Reset] Failed to uninstall', dir.name, ':', err.message);
                    }
                }
            }
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            // apps/ dir doesn't exist — nothing to uninstall
        }

        // Stop heartbeat
        const heartbeatService = require('./heartbeatService');
        heartbeatService.stop();

        // Clear onboarding config
        const config = await configManager.getConfig();
        delete config.onboarding;
        await configManager.persistConfig();
    }

    async onboard(token, adminUrl) {
        try {
            const systemDetails = await this.getSystemInfo();
            const config = await configManager.getConfig();

            // If already onboarded, reset first (uninstall all apps, stop heartbeat)
            if (config.onboarding && config.onboarding.status === 'onboarded') {
                console.log('[Onboarding] Already onboarded — resetting before re-onboard');
                try {
                    await this.resetApps();
                } catch (resetErr) {
                    console.error('[Onboarding] Reset failed:', resetErr.message);
                    // Continue with onboarding even if reset partially fails
                }
            }

            // Send onboarding request to IOAdmin via MQTT
            const { publishAndWait, subscribeToCommandTopics } = require('./masterMqttClient');
            const response = await publishAndWait(
                'lsg/onboard/' + token,
                { token: token, systemDetails: systemDetails },
                'lsg/onboard/' + token + '/res',
                30000
            );

            if (response.success) {
                const result = response.data || response;

                // Save onboarding status
                config.onboarding = {
                    token,
                    status: 'onboarded',
                    adminUrl: adminUrl || null,
                    connectionMode: result.connectionMode || 'direct',
                    onboardedAt: new Date().toISOString()
                };
                await configManager.persistConfig();

                // Install SSH public key from ioadmin for terminal access
                if (result.sshPublicKey) {
                    try {
                        await this.installSshPublicKey(result.sshPublicKey, result.sshTargetUsername);
                        console.log('[Onboarding] SSH public key installed for terminal access');
                    } catch (sshErr) {
                        console.error('[Onboarding] SSH key install failed:', sshErr.message);
                    }
                }

                // If admin provided VPN config, set up VPN automatically
                if (result.vpnConfig && result.vpnConfig.vpnFile) {
                    try {
                        const vpnService = require('./vpnService');
                        console.log('[Onboarding] VPN config received, setting up VPN profile...');
                        await vpnService.downloadAndSetupProfile(
                            result.vpnConfig.vpnFile,
                            'ioadmin-vpn'
                        );
                        await vpnService.enable();
                        console.log('[Onboarding] VPN enabled successfully');
                    } catch (vpnErr) {
                        console.error('[Onboarding] VPN auto-setup failed:', vpnErr.message);
                    }
                }

                // Subscribe to command topics now that we have a token
                try {
                    await subscribeToCommandTopics();
                    console.log('[Onboarding] Subscribed to command topics');
                } catch (mqttErr) {
                    console.error('[Onboarding] MQTT command subscribe failed:', mqttErr.message);
                }

                // Start heartbeat sender now that we are onboarded
                try {
                    const heartbeatService = require('./heartbeatService');
                    heartbeatService.start();
                } catch (hbErr) {
                    console.error('[Onboarding] Heartbeat start failed:', hbErr.message);
                }

                return { success: true, message: 'Onboarded successfully', connectionMode: result.connectionMode };
            } else {
                throw new Error((response.errors || ['Onboarding failed']).join(', '));
            }

        } catch (error) {
            console.error('Onboarding failed:', error.message);
            throw error;
        }
    }
}

module.exports = new OnboardingService();
