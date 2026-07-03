const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const configManager = require('./configManager');

const execAsync = promisify(exec);
const VPN_CONFIG_DIR = '/etc/openvpn/client';
const VPN_CONFIG_FILE = 'client.ovpn';
const VPN_SYSTEMD_CONFIG = '/etc/openvpn/client.conf';

class VPNService {
    constructor() {
        this.configPath = path.join(VPN_CONFIG_DIR, VPN_CONFIG_FILE);
    }

    async getServiceStatus() {
        try {
            const { stdout: status } = await execAsync('systemctl status openvpn@client');
            const { stdout: logs } = await execAsync('journalctl -u openvpn@client -n 50 --no-pager');
            return { status, logs };
        } catch (error) {
            // If service is not running, systemctl status will return error
            // We still want to get the logs in this case
            try {
                const { stdout: logs } = await execAsync('journalctl -u openvpn@client -n 50 --no-pager');
                return { 
                    status: error.stdout || 'Service not running',
                    logs 
                };
            } catch (logError) {
                return {
                    status: error.stdout || 'Service not running',
                    logs: 'Could not retrieve logs'
                };
            }
        }
    }

    async checkConfigPermissions() {
        try {
            const { stdout: lsOutput } = await execAsync(`ls -l ${this.configPath}`);
            const { stdout: ownerOutput } = await execAsync(`stat -c '%U:%G' ${this.configPath}`);
            return {
                permissions: lsOutput.trim(),
                ownership: ownerOutput.trim()
            };
        } catch (error) {
            return {
                permissions: null,
                ownership: null,
                error: error.message
            };
        }
    }

    async getVpnIpAddress() {
        try {
            // Method 1: Try to get IP from tun interface
            try {
                const { stdout: ifconfig } = await execAsync('ip addr show tun0 2>/dev/null');
                const tunMatch = ifconfig.match(/inet\s+([\d.]+)\/\d+/);
                if (tunMatch) {
                    return tunMatch[1];
                }
            } catch (error) {
                // tun0 might not exist or have different name
            }

            // Method 2: Try to get IP from OpenVPN logs
            try {
                const { stdout: logs } = await execAsync('journalctl -u openvpn@client -n 100 --no-pager');
                // Look for IP assignment in logs: "net_addr_v4_add: 10.8.0.6/24 dev tun0"
                const logMatch = logs.match(/net_addr_v4_add:\s+([\d.]+)\/\d+\s+dev\s+tun\d+/);
                if (logMatch) {
                    return logMatch[1];
                }
                
                // Alternative log pattern: "ifconfig tun0 10.8.0.6 netmask 255.255.255.0"
                const ifconfigMatch = logs.match(/ifconfig\s+tun\d+\s+([\d.]+)\s+/);
                if (ifconfigMatch) {
                    return ifconfigMatch[1];
                }
            } catch (error) {
                // Log parsing failed
            }

            // Method 3: Try to find any tun interface
            try {
                const { stdout: allTuns } = await execAsync('ip addr show type tun 2>/dev/null');
                const tunMatch = allTuns.match(/inet\s+([\d.]+)\/\d+/);
                if (tunMatch) {
                    return tunMatch[1];
                }
            } catch (error) {
                // No tun interfaces found
            }

            return null;
        } catch (error) {
            console.error('Error getting VPN IP address:', error);
            return null;
        }
    }

    async getStatus() {
        try {
            const { stdout } = await execAsync('systemctl is-active openvpn@client');
            const config = await configManager.getConfig();
            const serviceInfo = await this.getServiceStatus();
            const permissions = await this.checkConfigPermissions();
            const routing = await this.getRoutingStatus();

            // Get VPN IP address if connected
            const isActive = stdout.trim() === 'active';
            const vpnIp = isActive ? await this.getVpnIpAddress() : null;

            return {
                isEnabled: isActive,
                hasProfile: fs.existsSync(this.configPath),
                profileName: config?.vpn?.profileName || null,
                lastConnected: config?.vpn?.lastConnected || null,
                globalRouting: !routing.hasRoutePull,
                routingInfo: routing,
                serviceStatus: serviceInfo.status,
                serviceLogs: serviceInfo.logs,
                configPermissions: permissions,
                vpnIp: vpnIp
            };
        } catch (error) {
            const serviceInfo = await this.getServiceStatus();
            const permissions = await this.checkConfigPermissions();
            const routing = await this.getRoutingStatus();

            return {
                isEnabled: false,
                hasProfile: fs.existsSync(this.configPath),
                profileName: null,
                lastConnected: null,
                globalRouting: !routing.hasRoutePull,
                routingInfo: routing,
                serviceStatus: serviceInfo.status,
                serviceLogs: serviceInfo.logs,
                configPermissions: permissions,
                vpnIp: null
            };
        }
    }

    async validateOVPNFile(content) {
        // Basic validation of OVPN file structure
        const requiredFields = ['client', 'dev', 'proto', 'remote', 'resolv-retry', 'nobind', 'persist-key', 'persist-tun', 'verb'];
        const lines = content.split('\n');
        
        const foundFields = requiredFields.filter(field => 
            lines.some(line => line.trim().startsWith(field))
        );

        return {
            isValid: foundFields.length === requiredFields.length,
            missingFields: requiredFields.filter(field => !foundFields.includes(field))
        };
    }

    async setupConfigSymlink() {
        try {
            // Remove existing symlink or file if it exists
            try {
                await execAsync(`sudo rm -f ${VPN_SYSTEMD_CONFIG}`);
            } catch (error) {
                // Ignore error if file doesn't exist
            }

            // Create symlink
            await execAsync(`sudo ln -s ${this.configPath} ${VPN_SYSTEMD_CONFIG}`);
            
            // Verify symlink
            const { stdout } = await execAsync(`ls -l ${VPN_SYSTEMD_CONFIG}`);
            if (!stdout.includes(this.configPath)) {
                throw new Error('Failed to verify symlink creation');
            }

            return true;
        } catch (error) {
            throw new Error(`Failed to setup config symlink: ${error.message}`);
        }
    }

    async setupProfileFromContent(ovpnContent, profileName) {
        try {
            // Validate OVPN file
            const validation = await this.validateOVPNFile(ovpnContent);
            if (!validation.isValid) {
                throw new Error(`Invalid OVPN file. Missing required fields: ${validation.missingFields.join(', ')}`);
            }

            // Ensure VPN config directory exists
            if (!fs.existsSync(VPN_CONFIG_DIR)) {
                await execAsync(`sudo mkdir -p ${VPN_CONFIG_DIR}`);
            }

            // Save OVPN file with proper permissions
            await execAsync(`sudo bash -c 'echo "${ovpnContent}" > ${this.configPath}'`);
            await execAsync(`sudo chown root:root ${this.configPath}`);
            await execAsync(`sudo chmod 600 ${this.configPath}`);

            // Setup symlink for systemd service
            await this.setupConfigSymlink();

            // Update app config
            const config = await configManager.getConfig();
            config.vpn = {
                profileName,
                configPath: this.configPath,
                systemdPath: VPN_SYSTEMD_CONFIG,
                lastUpdated: new Date().toISOString()
            };
            await configManager.persistConfig();

            return { success: true, message: 'VPN profile configured successfully' };
        } catch (error) {
            throw new Error(`Failed to setup VPN profile: ${error.message}`);
        }
    }

    async downloadAndSetupProfile(signedUrl, profileName) {
        try {
            const response = await axios.get(signedUrl);
            return await this.setupProfileFromContent(response.data, profileName);
        } catch (error) {
            throw new Error(`Failed to setup VPN profile: ${error.message}`);
        }
    }

    async enable() {
        try {
            if (!fs.existsSync(this.configPath)) {
                throw new Error('No VPN profile found. Please configure a VPN profile first.');
            }

            // Check file permissions and symlink
            const permissions = await this.checkConfigPermissions();
            if (permissions.error) {
                throw new Error(`Config file permission error: ${permissions.error}`);
            }

            // Verify/repair symlink
            await this.setupConfigSymlink();

            // Reload systemd to pick up any changes
            await execAsync('sudo systemctl daemon-reload');

            await execAsync('sudo systemctl restart openvpn@client');

            // Wait for service to stabilize
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Check using is-active (returns clean "active"/"inactive"/"failed", no log noise)
            var isActiveResult = await execAsync('systemctl is-active openvpn@client').catch(function (e) { return { stdout: (e.stdout || 'unknown').toString() }; });
            if (isActiveResult.stdout.trim() !== 'active') {
                var serviceInfo = await this.getServiceStatus();
                throw new Error('OpenVPN service failed to start.\nStatus: ' + serviceInfo.status + '\nLogs: ' + serviceInfo.logs);
            }
            
            // Update last connected timestamp
            const config = await configManager.getConfig();
            if (config.vpn) {
                config.vpn.lastConnected = new Date().toISOString();
                await configManager.persistConfig();
            }

            return { success: true, message: 'VPN enabled successfully' };
        } catch (error) {
            throw new Error(`Failed to enable VPN: ${error.message}`);
        }
    }

    async disable() {
        try {
            await execAsync('sudo systemctl stop openvpn@client');
            return { success: true, message: 'VPN disabled successfully' };
        } catch (error) {
            const serviceInfo = await this.getServiceStatus();
            throw new Error(`Failed to disable VPN: ${error.message}\nStatus: ${serviceInfo.status}\nLogs: ${serviceInfo.logs}`);
        }
    }

    async getRoutingStatus() {
        try {
            // Check if VPN profile exists
            if (!fs.existsSync(this.configPath)) {
                return {
                    hasRoutePull: false,
                    message: 'No VPN profile configured'
                };
            }

            // Check if route-nopull is in the config
            const { stdout: configContent } = await execAsync(`cat ${this.configPath}`);
            const hasRoutePull = !configContent.includes('route-nopull');

            return {
                hasRoutePull,
                message: hasRoutePull ? 'Global routing enabled' : 'Global routing disabled'
            };
        } catch (error) {
            console.error('Error getting routing status:', error);
            return {
                hasRoutePull: false,
                message: 'Failed to get routing status'
            };
        }
    }

    async setGlobalRouting(enable) {
        try {
            // Check if VPN profile exists
            if (!fs.existsSync(this.configPath)) {
                throw new Error('No VPN profile found');
            }

            // Read current config
            const { stdout: currentConfig } = await execAsync(`cat ${this.configPath}`);
            const lines = currentConfig.split('\n');

            // Remove any existing route-nopull option
            const filteredLines = lines.filter(line => !line.trim().startsWith('route-nopull'));

            // Add route-nopull if global routing is disabled
            if (!enable) {
                filteredLines.push('route-nopull');
            }

            // Write updated config
            const newConfig = filteredLines.join('\n');
            await execAsync(`sudo bash -c 'echo "${newConfig}" > ${this.configPath}'`);

            // Update config permissions
            await execAsync(`sudo chown root:root ${this.configPath}`);
            await execAsync(`sudo chmod 600 ${this.configPath}`);

            // Restart OpenVPN if it's running
            const status = await this.getStatus();
            if (status.isEnabled) {
                await this.enable(); // This will restart the service
            }

            // Get new routing status
            const routingStatus = await this.getRoutingStatus();

            // Update config
            const config = await configManager.getConfig();
            if (config.vpn) {
                config.vpn.globalRouting = enable;
                config.vpn.lastRoutingUpdate = new Date().toISOString();
                await configManager.persistConfig();
            }

            return {
                success: true,
                message: `Global routing ${enable ? 'enabled' : 'disabled'} successfully`,
                routing: routingStatus
            };
        } catch (error) {
            throw new Error(`Failed to ${enable ? 'enable' : 'disable'} global routing: ${error.message}`);
        }
    }
}

module.exports = new VPNService();