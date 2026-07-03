const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const os = require('os');
const dns = require('dns');
const networkService = require('../services/networkService');
const vpnService = require('../services/vpnService');
const scheduleService = require('../services/scheduleService');
const systemService = require('../services/systemService');
const path = require('path');
const onboardingService = require('../services/onboardingService');

const { loadProtocolsConfig } = require('./protocol.controller');
const appRegistry = require('../services/appRegistry');

async function checkInternetConnectivity() {
    return new Promise((resolve) => {
        dns.resolve('8.8.8.8', (err) => {
            resolve(!err);
        });
    });
}

async function getFirewallStatus() {
    try {
        const { stdout: ufw } = await execAsync('sudo ufw status numbered');
        const isEnabled = ufw.toLowerCase().includes('status: active');
        
        if (!isEnabled) {
            return {
                enabled: false,
                rulesCount: 0
            };
        }

        // Parse rules and count unique logical rules (not IPv4/IPv6 duplicates)
        const lines = ufw.split('\n');
        const ruleLines = lines.filter(line => line.trim().match(/^\[\s*\d+\]/));
        
        // Create a set to track unique rules (without IPv6 duplicates)
        const uniqueRules = new Set();
        
        ruleLines.forEach(line => {
            // Extract the rule content after the number
            const ruleMatch = line.match(/^\[\s*\d+\]\s+(.*?)$/);
            if (!ruleMatch) return;
            
            let ruleContent = ruleMatch[1].trim();
            
            // Normalize the rule by removing IPv6-specific indicators
            // This helps us deduplicate IPv4/IPv6 versions of the same rule
            const normalizedRule = ruleContent
                .replace(/\s*\(v6\)\s*/g, '') // Remove (v6) markers
                .replace(/Anywhere \(v6\)/g, 'Anywhere') // Normalize IPv6 anywhere
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();
            
            // Only add non-empty normalized rules
            if (normalizedRule) {
                uniqueRules.add(normalizedRule);
            }
        });
        
        return {
            enabled: isEnabled,
            rulesCount: ruleLines.length,
            uniqueEntries: uniqueRules.size // Keep track of actual UFW entries for debugging
        };
    } catch (error) {
        console.error('Error checking firewall status:', error);
        return {
            enabled: false,
            rulesCount: 0,
            error: error.message
        };
    }
}

async function getSystemTimeInfo() {
    try {
        const { stdout: timezoneInfo } = await execAsync('timedatectl show');
        const { stdout: ntpEnabled } = await execAsync('timedatectl show --property=NTP --value');
        
        const timezone = timezoneInfo.match(/Timezone=(.*)/)?.[1] || 'unknown';
        const isNtpEnabled = ntpEnabled.trim() === 'yes';
        
        return {
            currentTime: new Date().toISOString(),
            timezone,
            ntpEnabled: isNtpEnabled
        };
    } catch (error) {
        console.error('Error getting system time info:', error);
        return {
            currentTime: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ntpEnabled: false,
            error: error.message
        };
    }
}

async function getProtocolsStatus() {
    try {
        const protocolsConfig = await loadProtocolsConfig();
        const registryEntries = appRegistry.getAll();
        const protocols = [];

        for (const [protocol, config] of Object.entries(protocolsConfig)) {
            const registryEntry = registryEntries[config.appName] || null;
            const installed = !!registryEntry;
            let running = false;

            if (installed) {
                try {
                    const scriptPath = path.join(registryEntry.installPath, 'scripts', 'status.sh');
                    await execAsync(`bash "${scriptPath}"`, { cwd: registryEntry.installPath });
                    running = true;
                } catch { /* non-zero exit = not running */ }
            }

            protocols.push({ name: protocol, appName: config.appName, installed, running });
        }

        return protocols;
    } catch (error) {
        console.error('Error getting protocols status:', error);
        return [];
    }
}

async function getSystemOverview(req, res) {
    try {
        // 0. Resource Stats (CPU, RAM, Disk)
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const cpuUsage = await onboardingService.getCpuUsage();
        const diskInfo = await onboardingService.getDiskInfo();

        // 1. Network Interfaces
        const allIfaces = await networkService.getAllNetworkInterfaces();
        const interfaces = allIfaces.map(iface => ({
            name: iface.name,
            addresses: iface.addresses.map(addr => ({
                address: addr.address,
                family: addr.family,
                internal: addr.internal,
            })),
        }));

        // 2. Firewall Status
        const firewallStatus = await getFirewallStatus();

        // 3. Internet Connectivity
        const connectivityResult = await networkService.checkInternetConnectivity();
        const internetConnected = connectivityResult.connected;

        // 4. System Time Info
        const timeInfo = await getSystemTimeInfo();

        // 5. Scheduled Restarts
        const oneTimeSchedules = await systemService.getScheduledRestarts();
        
        // Get only active recurring schedules (with running cron jobs)
        const activeRecurringSchedules = await scheduleService.getActiveSchedules();
        
        // Format schedules for frontend compatibility
        // Frontend expects all schedules in restartSchedules array with recurring flag
        const formattedRecurringSchedules = activeRecurringSchedules.map(schedule => ({
            ...schedule,
            recurring: true
        }));
        
        const formattedOneTimeSchedules = oneTimeSchedules.map(schedule => ({
            ...schedule,
            recurring: false
        }));
        
        const allSchedules = [...formattedRecurringSchedules, ...formattedOneTimeSchedules];

        // 6. VPN Status
        const vpnStatus = await vpnService.getStatus();

        // 7. Protocol Apps Status
        const protocols = await getProtocolsStatus();

        // 8. Data Forwarding Status (Redpanda broker + active pipelines)
        let dataForwardingStatus = { brokerRunning: false, pipelines: [] };
        try {
            await execAsync('systemctl is-active --quiet redpanda');
            dataForwardingStatus.brokerRunning = true;
        } catch { /* broker not running */ }
        try {
            const { stdout } = await execAsync(
                "systemctl list-units --type=service --all --no-legend --plain 2>/dev/null | awk '{print $1}' | grep '^redpanda-connect@' || true"
            );
            dataForwardingStatus.pipelines = stdout.trim().split('\n').filter(Boolean)
                .map(s => s.replace('redpanda-connect@', '').replace('.service', ''));
        } catch { /* ignore */ }

        res.json({
            timestamp: new Date().toISOString(),
            resources: {
                cpu: {
                    cores: cpus.length,
                    model: cpus[0].model,
                    usage: cpuUsage
                },
                ram: {
                    total: `${Math.round(totalMem / (1024 * 1024 * 1024))} GB`,
                    free: `${Math.round(freeMem / (1024 * 1024 * 1024))} GB`,
                    usage: Math.round(((totalMem - freeMem) / totalMem) * 100)
                },
                disk: {
                    total: diskInfo.total,
                    usage: diskInfo.usagePercent
                },
                uptime: onboardingService.formatUptime(os.uptime())
            },
            network: {
                interfaces,
                internetConnected
            },
            firewall: firewallStatus,
            time: timeInfo,
            scheduling: {
                restartSchedules: allSchedules
            },
            vpn: {
                configured: vpnStatus.hasProfile,
                enabled: vpnStatus.isEnabled,
                status: vpnStatus.serviceStatus,
                lastConnected: vpnStatus.lastConnected,
                vpnIp: vpnStatus.vpnIp
            },
            protocols: {
                total: protocols.length,
                installed: protocols.filter(p => p.installed).length,
                running: protocols.filter(p => p.running).length,
                details: protocols
            },
            dataForwarding: dataForwardingStatus
        });
    } catch (error) {
        console.error('Error getting system overview:', error);
        res.status(500).json({ error: error.message });
    }
}

async function getAppUptime(req, res) {
    try {
        const scriptPath = path.join(process.cwd(), 'scripts', 'uptime.sh');
        const { stdout } = await execAsync(`bash "${scriptPath}"`);
        const epoch = parseInt(stdout.trim(), 10);
        if (!epoch || isNaN(epoch)) {
            return res.json({ startedAt: null });
        }
        res.json({ startedAt: new Date(epoch * 1000).toISOString() });
    } catch {
        res.json({ startedAt: null });
    }
}

module.exports = {
    getSystemOverview,
    getAppUptime
}; 