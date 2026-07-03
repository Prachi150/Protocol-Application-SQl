const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');

const execPromise = util.promisify(exec);
const SCRIPTS = path.join(process.cwd(), 'scripts', 'network');

function prefixToNetmask(prefix) {
    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    return [24, 16, 8, 0].map(s => (mask >> s) & 0xFF).join('.');
}

function netmaskToPrefix(netmask) {
    return netmask.split('.').reduce((bits, octet) => {
        let n = parseInt(octet, 10);
        let count = 0;
        while (n & 0x80) { count++; n = (n << 1) & 0xFF; }
        return bits + count;
    }, 0);
}

function computeSubnet(ip, prefixlen) {
    const parts = ip.split('.').map(Number);
    const ipNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    const maskNum = prefixlen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixlen)) >>> 0;
    const sub = (ipNum & maskNum) >>> 0;
    return [24, 16, 8, 0].map(s => (sub >> s) & 0xFF).join('.') + '/' + prefixlen;
}

function run(script, ...args) {
    const escaped = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
    return execPromise(`sudo bash "${SCRIPTS}/${script}" ${escaped}`);
}

class NetworkService {
    async validateInterface(interfaceName) {
        if (!interfaceName) throw new Error('Interface name is required');

        let linkData;
        try {
            const { stdout } = await execPromise(`ip -j link show "${interfaceName}"`);
            linkData = JSON.parse(stdout)[0];
        } catch {
            const { stdout: allLinks } = await execPromise('ip -j link show').catch(() => ({ stdout: '[]' }));
            const available = JSON.parse(allLinks).map(i => i.ifname);
            throw new Error(`Interface "${interfaceName}" not found. Available: ${available.join(', ')}`);
        }

        const isUp = linkData.operstate === 'UP';

        const isWireless = await fs.access(`/sys/class/net/${interfaceName}/wireless`)
            .then(() => true)
            .catch(() => fs.access(`/sys/class/net/${interfaceName}/phy80211`).then(() => true).catch(() => false));

        const interfaceType = isWireless ? 'wireless' : linkData.link_type === 'ether' ? 'ethernet' : 'unknown';
        let additionalInfo = {};

        if (isWireless) {
            try {
                const { stdout } = await execPromise(`iw dev ${interfaceName} info`);
                additionalInfo = {
                    ssid: stdout.match(/ssid\s(.+)/)?.[1] || null,
                    txPower: stdout.match(/txpower\s(.+)/)?.[1] || null,
                };
            } catch {
                try {
                    const { stdout } = await execPromise(`iwconfig ${interfaceName}`);
                    additionalInfo = {
                        ssid: stdout.match(/ESSID:"([^"]+)"/)?.[1] || null,
                        txPower: stdout.match(/Tx-Power=([^\s]+)/)?.[1] || null,
                    };
                } catch {}
            }
        }

        return {
            exists: true,
            name: interfaceName,
            type: interfaceType,
            state: isUp ? 'up' : 'down',
            additionalInfo,
        };
    }

    async getAllNetworkInterfaces() {
        try {
            const { stdout } = await execPromise(`bash "${SCRIPTS}/get-interfaces.sh"`);
            const data = JSON.parse(stdout);

            if (data.error) throw new Error(data.error);

            // Build per-interface route info from ip -j route output
            const routeInfo = {};
            let defaultIface = null;
            let defaultGateway = null;

            for (const r of (data.routes || [])) {
                const dev = r.dev;
                if (!dev) continue;
                if (!routeInfo[dev]) routeInfo[dev] = { gateway: null, routes: [] };
                if (r.dst === 'default') {
                    routeInfo[dev].gateway = r.gateway || null;
                    if (!defaultIface) { defaultIface = dev; defaultGateway = r.gateway || null; }
                } else {
                    routeInfo[dev].routes.push(r.dst);
                }
            }

            const result = [];
            for (const iface of data.addresses) {
                if (iface.link_type === 'loopback') continue;

                const name = iface.ifname;
                const isUp = iface.operstate === 'UP';

                const isWireless = await fs.access(`/sys/class/net/${name}/wireless`)
                    .then(() => true)
                    .catch(() => fs.access(`/sys/class/net/${name}/phy80211`).then(() => true).catch(() => false));

                const interfaceType = isWireless ? 'wireless' : iface.link_type === 'ether' ? 'ethernet' : 'unknown';
                let additionalInfo = {};

                if (isWireless) {
                    try {
                        const { stdout: iwOut } = await execPromise(`iw dev ${name} info`);
                        additionalInfo = {
                            ssid: iwOut.match(/ssid\s(.+)/)?.[1] || null,
                            txPower: iwOut.match(/txpower\s(.+)/)?.[1] || null,
                        };
                    } catch {
                        try {
                            const { stdout: iwcOut } = await execPromise(`iwconfig ${name}`);
                            additionalInfo = {
                                ssid: iwcOut.match(/ESSID:"([^"]+)"/)?.[1] || null,
                                txPower: iwcOut.match(/Tx-Power=([^\s]+)/)?.[1] || null,
                            };
                        } catch {}
                    }
                }

                let carrier = null;
                if (interfaceType === 'ethernet') {
                    try {
                        const raw = await fs.readFile(`/sys/class/net/${name}/carrier`, 'utf8');
                        carrier = raw.trim() === '1';
                    } catch { /* interface down or carrier file unavailable */ }
                }

                const addresses = (iface.addr_info || [])
                    .filter(a => a.scope !== 'link' && !a.temporary)
                    .map(a => {
                        const entry = {
                            address: a.local,
                            family: a.family === 'inet' ? 'IPv4' : a.family === 'inet6' ? 'IPv6' : a.family,
                            internal: false,
                            mac: iface.address || null,
                            prefixlen: a.prefixlen,
                        };
                        if (a.family === 'inet') {
                            entry.netmask = prefixToNetmask(a.prefixlen);
                            entry.subnet = computeSubnet(a.local, a.prefixlen);
                        }
                        return entry;
                    });

                result.push({
                    exists: true,
                    name,
                    type: interfaceType,
                    state: isUp ? 'up' : 'down',
                    addresses,
                    additionalInfo,
                    gateway: routeInfo[name]?.gateway || (defaultIface === name ? defaultGateway : null),
                    routes: routeInfo[name]?.routes || [],
                    isDefaultRoute: defaultIface === name,
                    carrier,
                });
            }

            return result;
        } catch (error) {
            throw new Error(`Failed to get network interfaces: ${error.message}`);
        }
    }

    async setNetworkInterfaceConfig(interfaceName, config) {
        try {
            if (!config) throw new Error('Configuration object is required');

            const interfaceInfo = await this.validateInterface(interfaceName);

            if (config.wireless && interfaceInfo.type !== 'wireless') {
                throw new Error(`Cannot configure wireless settings on non-wireless interface "${interfaceName}"`);
            }

            if (config.ipv4 && typeof config.ipv4 === 'object') {
                if (config.ipv4.method === 'manual') {
                    if (!config.ipv4.address) throw new Error('Static IPv4 configuration requires an IP address');
                    const prefix = config.ipv4.netmask ? netmaskToPrefix(config.ipv4.netmask) : 24;
                    const addrPrefix = `${config.ipv4.address}/${prefix}`;
                    const gw = config.ipv4.setAsDefaultRoute !== false ? (config.ipv4.gateway || '') : '';
                    await run('set-ipv4-static.sh', interfaceName, addrPrefix, gw);
                } else if (config.ipv4.method === 'auto') {
                    await run('set-ipv4-dhcp.sh', interfaceName);
                }
            }

            if (config.ipv6 && typeof config.ipv6 === 'object') {
                if (config.ipv6.method === 'manual') {
                    if (!config.ipv6.address) throw new Error('Static IPv6 configuration requires an IP address');
                    await run('set-ipv6-static.sh', interfaceName, config.ipv6.address, config.ipv6.gateway || '');
                } else if (config.ipv6.method === 'auto') {
                    await run('set-ipv6-auto.sh', interfaceName);
                }
            }

            if (config.dns && typeof config.dns === 'object') {
                if (config.dns.method === 'manual' && Array.isArray(config.dns.servers) && config.dns.servers.length > 0) {
                    await run('set-dns.sh', interfaceName, ...config.dns.servers);
                }
            }

            if (config.wireless && typeof config.wireless === 'object' && config.wireless.ssid) {
                await run(
                    'set-wireless.sh',
                    interfaceName,
                    config.wireless.ssid,
                    config.wireless.security || 'none',
                    config.wireless.password || ''
                );
            }

            if (config.state === 'up' || config.state === 'down') {
                await run('set-interface-state.sh', interfaceName, config.state);
            }

            return {
                success: true,
                message: `Network interface ${interfaceName} configured successfully`,
                appliedConfig: { interface: interfaceName, interfaceInfo, ...config },
            };
        } catch (error) {
            console.error('Service error:', error);
            throw new Error(`Failed to configure network interface: ${error.message}`);
        }
    }

    async checkInternetConnectivity() {
        try {
            const { stdout } = await execPromise(`bash "${SCRIPTS}/get-connectivity.sh"`);
            const d = JSON.parse(stdout);

            const passedChecks = [d.dns, d.ping, d.http].filter(Boolean).length;

            return {
                connected: passedChecks >= 2,
                checks: {
                    dns: d.dns || false,
                    http: d.http || false,
                    ping: d.ping || false,
                },
                latency: d.latency ? parseFloat(d.latency) : null,
                details: {
                    dns: d.dns ? 'DNS resolution successful' : 'DNS resolution failed',
                    ping: d.ping ? 'Ping successful' : 'Ping failed',
                    http: d.http ? 'HTTP connection successful' : 'HTTP connection failed',
                    ...(d.interface ? { route: { interface: d.interface, route: d.route } } : {}),
                },
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            throw new Error(`Failed to check internet connectivity: ${error.message}`);
        }
    }

    async getUFWStatus() {
        try {
            const { stdout: statusOutput } = await execPromise('sudo ufw status verbose');
            return {
                enabled: statusOutput.toLowerCase().includes('status: active'),
                defaultIncoming: statusOutput.match(/Default:\s+(\w+)\s+\(incoming\)/)?.[1]?.toLowerCase() || 'deny',
                defaultOutgoing: statusOutput.match(/Default:\s+(\w+)\s+\(outgoing\)/)?.[1]?.toLowerCase() || 'allow',
                logging: statusOutput.match(/Logging:\s+(\w+)/)?.[1]?.toLowerCase() || 'off',
                raw: statusOutput,
            };
        } catch (error) {
            throw new Error(`Failed to get UFW status: ${error.message}`);
        }
    }

    async getUFWRules() {
        try {
            const { stdout: numberedOutput } = await execPromise('sudo ufw status numbered');
            const rules = [];
            const ruleLines = numberedOutput.split('\n');

            for (const line of ruleLines) {
                const ruleMatch = line.match(/^\[\s*(\d+)\]\s+(.+)$/);
                if (ruleMatch) {
                    const [_, number, ruleText] = ruleMatch;
                    const rule = {
                        number: parseInt(number),
                        action: '',
                        direction: '',
                        from: 'any',
                        to: 'any',
                        port: null,
                        proto: null,
                        ipVersion: 'ipv4',
                        raw: ruleText.trim(),
                    };

                    if (ruleText.includes('(v6)')) rule.ipVersion = 'ipv6';

                    const portProtoMatch = ruleText.match(/(?:^|\s)(\d+(?::\d+)?)\/(tcp|udp)/i) ||
                                         ruleText.match(/port\s+(\d+(?::\d+)?)\s+proto\s+(tcp|udp)/i);
                    if (portProtoMatch) {
                        rule.port = portProtoMatch[1];
                        rule.proto = portProtoMatch[2].toLowerCase();
                    } else {
                        const standalonePort = ruleText.match(/^(\d+)\s+/);
                        if (standalonePort) rule.port = standalonePort[1];
                    }

                    const actionMatch = ruleText.match(/(ALLOW|DENY|LIMIT|REJECT)\s+(IN|OUT)/i);
                    if (actionMatch) {
                        rule.action = actionMatch[1].toLowerCase();
                        rule.direction = actionMatch[2].toLowerCase();
                    }

                    const fromMatch = ruleText.match(/from\s+(\S+?)(?:\s|$)/i);
                    if (fromMatch) {
                        rule.from = fromMatch[1] === 'Anywhere' ? 'any' : fromMatch[1];
                    } else if (ruleText.includes('Anywhere')) {
                        rule.from = 'any';
                    } else {
                        const ipMatch = ruleText.match(/(?:ALLOW|DENY|LIMIT|REJECT)\s+(?:IN|OUT)\s+(\d+\.\d+\.\d+\.\d+)/i);
                        if (ipMatch) rule.from = ipMatch[1];
                    }

                    const toMatch = ruleText.match(/to\s+(\S+?)(?:\s|$)/i);
                    if (toMatch) rule.to = toMatch[1] === 'Anywhere' ? 'any' : toMatch[1];

                    if (rule.ipVersion === 'ipv6') {
                        if (rule.from === 'Anywhere (v6)') rule.from = 'any';
                        if (rule.to === 'Anywhere (v6)') rule.to = 'any';
                    }

                    rules.push(rule);
                }
            }

            return rules;
        } catch (error) {
            throw new Error(`Failed to get UFW rules: ${error.message}`);
        }
    }

    async addUFWRules(rules) {
        try {
            const results = [];

            for (const rule of rules) {
                let command = '';
                try {
                    if (!rule.action) throw new Error('Rule action is required (allow, deny, reject, or limit)');
                    if (!rule.direction) throw new Error('Rule direction is required (in or out)');

                    command = 'sudo ufw';
                    if (rule.ipVersion === 'ipv6') command += ' --ipv6';
                    command += ` ${rule.action} ${rule.direction}`;
                    if (rule.proto) command += ` proto ${rule.proto}`;
                    if (rule.from && rule.from !== 'any') command += ` from ${rule.from}`;
                    if (rule.to && rule.to !== 'any') command += ` to ${rule.to}`;
                    if (rule.port) command += ` port ${rule.port}`;

                    const { stdout } = await execPromise(command);
                    results.push({ success: true, rule, command, message: stdout || 'Rule added successfully' });
                } catch (error) {
                    results.push({ success: false, rule, command, error: error.message });
                }
            }

            await execPromise('sudo ufw reload');
            return results;
        } catch (error) {
            throw new Error(`Failed to add UFW rules: ${error.message}`);
        }
    }
}

module.exports = new NetworkService();
