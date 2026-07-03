const networkService = require('../services/networkService');

class NetworkController {
    async getAllNetworkInterfaces(req, res) {
        try {
            const interfaces = await networkService.getAllNetworkInterfaces();
            res.json({ success: true, data: interfaces });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async checkInterface(req, res) {
        try {
            const { interfaceName } = req.params;
            
            if (!interfaceName) {
                return res.status(400).json({
                    success: false,
                    error: 'Interface name is required'
                });
            }

            const interfaceInfo = await networkService.validateInterface(interfaceName);
            res.json({
                success: true,
                exists: true,
                data: interfaceInfo
            });
        } catch (error) {
            // If it's an interface not found error, return 404
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    exists: false,
                    error: error.message
                });
            }
            // For other errors, return 500
            res.status(500).json({
                success: false,
                exists: false,
                error: error.message
            });
        }
    }

    async setNetworkInterfaceConfig(req, res) {
        try {
            console.log('Request headers:', req.headers);
            console.log('Raw request body:', req.body);
            console.log('Request body type:', typeof req.body);
            
            const { interfaceName } = req.params;
            const config = req.body;

            console.log('Received config:', req.body, JSON.stringify(config, null, 2));
            console.log('Interface name:', interfaceName);

            // First validate basic requirements
            if (!interfaceName) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Interface name is required' 
                });
            }

            if (!config) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Configuration object is required' 
                });
            }

            // Validate that at least one configuration option is provided
            const hasConfig = (
                config.ipv4 || 
                config.ipv6 || 
                config.dns || 
                config.routes || 
                config.wireless ||
                config.state
            );

            console.log('Has config:', hasConfig);

            if (!hasConfig) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'At least one configuration parameter (ipv4, ipv6, dns, routes, wireless, or state) is required' 
                });
            }

            // Check if interface exists and get its info
            let interfaceInfo;
            try {
                interfaceInfo = await networkService.validateInterface(interfaceName);
                console.log('Interface validation result:', JSON.stringify(interfaceInfo, null, 2));

                // Check interface type compatibility with requested configuration
                if (config.wireless && interfaceInfo.type !== 'wireless') {
                    return res.status(400).json({
                        success: false,
                        error: `Cannot configure wireless settings on non-wireless interface "${interfaceName}". Interface type is "${interfaceInfo.type}".`
                    });
                }
            } catch (error) {
                // If interface doesn't exist, return 404 with available interfaces
                if (error.message.includes('not found')) {
                    return res.status(404).json({
                        success: false,
                        error: error.message
                    });
                }
                throw error; // Re-throw other errors
            }

            // Validate IPv4 configuration if provided
            if (config.ipv4) {
                if (!config.ipv4.method) {
                    return res.status(400).json({
                        success: false,
                        error: 'IPv4 configuration requires a method (auto or manual)'
                    });
                }
                if (config.ipv4.method === 'manual' && !config.ipv4.address) {
                    return res.status(400).json({
                        success: false,
                        error: 'Manual IPv4 configuration requires an address'
                    });
                }
            }

            // Validate IPv6 configuration if provided
            if (config.ipv6) {
                if (!config.ipv6.method) {
                    return res.status(400).json({
                        success: false,
                        error: 'IPv6 configuration requires a method (auto or manual)'
                    });
                }
                if (config.ipv6.method === 'manual' && !config.ipv6.address) {
                    return res.status(400).json({
                        success: false,
                        error: 'Manual IPv6 configuration requires an address'
                    });
                }
            }

            // Validate DNS configuration if provided
            if (config.dns) {
                if (!config.dns.method) {
                    return res.status(400).json({
                        success: false,
                        error: 'DNS configuration requires a method (auto or manual)'
                    });
                }
                if (config.dns.method === 'manual' && (!config.dns.servers || !config.dns.servers.length)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Manual DNS configuration requires at least one server'
                    });
                }
            }

            // Validate wireless configuration if provided
            if (config.wireless) {
                if (!config.wireless.ssid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Wireless configuration requires an SSID'
                    });
                }
                if (config.wireless.security === 'wpa-psk' && !config.wireless.password) {
                    return res.status(400).json({
                        success: false,
                        error: 'WPA-PSK security requires a password'
                    });
                }
                if (config.wireless.security === 'wpa-eap' && (!config.wireless.identity || !config.wireless.password)) {
                    return res.status(400).json({
                        success: false,
                        error: 'WPA-EAP security requires both identity and password'
                    });
                }
            }

            // Validate routes if provided
            if (config.routes) {
                if (!Array.isArray(config.routes)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Routes must be an array'
                    });
                }
                for (const route of config.routes) {
                    if (!route.destination || !route.gateway) {
                        return res.status(400).json({
                            success: false,
                            error: 'Each route must specify both destination and gateway'
                        });
                    }
                }
            }

            const result = await networkService.setNetworkInterfaceConfig(interfaceName, config);
            res.json(result);
        } catch (error) {
            console.error('Error in setNetworkInterfaceConfig:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async checkInternetConnectivity(req, res) {
        try {
            const connectivityInfo = await networkService.checkInternetConnectivity();
            res.json({
                success: true,
                data: connectivityInfo
            });
        } catch (error) {
            console.error('Error checking internet connectivity:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async getUFWStatus(req, res) {
        try {
            const status = await networkService.getUFWStatus();
            res.json({
                success: true,
                data: status
            });
        } catch (error) {
            console.error('Error getting UFW status:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async getUFWRules(req, res) {
        try {
            const rules = await networkService.getUFWRules();
            res.json({
                success: true,
                data: rules
            });
        } catch (error) {
            console.error('Error getting UFW rules:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async addUFWRules(req, res) {
        try {
            const rules = req.body;

            // Validate request body
            if (!Array.isArray(rules)) {
                return res.status(400).json({
                    success: false,
                    error: 'Request body must be an array of rules'
                });
            }

            // Validate each rule
            for (const rule of rules) {
                if (!rule.direction) {
                    return res.status(400).json({
                        success: false,
                        error: 'Each rule must specify a direction (in/out)'
                    });
                }
            }

            const results = await networkService.addUFWRules(rules);
            res.json({
                success: true,
                data: results
            });
        } catch (error) {
            console.error('Error adding UFW rules:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = new NetworkController(); 