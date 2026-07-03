// API Configuration
// This file centralizes all API-related configuration

// Base API URL - can be overridden by environment variables
// Default to empty string (relative URLs) so frontend works when served from same Express server
const API_BASE_URL = import.meta.env.VITE_API_URL !== undefined ? import.meta.env.VITE_API_URL : '';

// API endpoints configuration
export const API_CONFIG = {
  BASE_URL: API_BASE_URL,
  ENDPOINTS: {
    // Authentication
    AUTH: {
      LOGIN: '/api/auth/login',
    },
    
    // Network Management
    NETWORK: {
      INTERFACES: '/api/network/interfaces',
      FIREWALL: {
        RULES: '/api/network/firewall/rules',
        STATUS: '/api/network/firewall/status',
        ENABLE: '/api/network/firewall/enable',
        DISABLE: '/api/network/firewall/disable',
      },
      CONNECTIVITY: '/api/network/connectivity',
    },
    
    // Remote Management
    REMOTE: {
      TIME: '/api/remote-management/time',
      TIME_ZONES: '/api/remote-management/time/zones',
      RESTART: '/api/remote-management/restart',
      VPN: {
        STATUS: '/api/remote-management/vpn/status',
        TOGGLE: '/api/remote-management/vpn/toggle',
        CONFIG: '/api/remote-management/vpn/config',
        UPLOAD: '/api/remote-management/vpn/upload',
        ROUTING: '/api/remote-management/vpn/routing',
      },
    },
    
    // Data Management
    DATA: {
      POLLING: '/api/data-polling',
      FORWARDING: '/api/data-forwarding',
    },
    
    // Data Polling
    POLLING: {
      PROTOCOLS: '/api/polling/protocols',
      INSTALL: '/api/polling/protocols/install',
      UNINSTALL_STATUS: '/api/polling/protocols',
    },
    
    // Redpanda data forwarding
    REDPANDA: {
      STATUS:            '/api/redpanda/status',
      PIPELINES:         '/api/redpanda/pipelines',
      PIPELINE:          '/api/redpanda/pipeline',
      PIPELINE_VALIDATE: '/api/redpanda/pipeline/validate',
      LOGS:              '/api/redpanda/logs',
      BROKER_CONFIG:     '/api/redpanda/broker/config',
      BROKER_RESTART:    '/api/redpanda/broker/restart',
      BROKER_TOPICS:     '/api/redpanda/broker/topics',
      CONSUMERS:         '/api/redpanda/consumers',
      TOPICS:            '/api/redpanda/topics',
    },
    
    // Overview
    OVERVIEW: '/api/overview',
    
    // System
    SYSTEM: {
      OVERVIEW: '/api/system/overview',
    },

    // Onboarding
    ONBOARDING: {
      ONBOARD: '/api/system/onboard',
      STATUS: '/api/system/onboard/status',
      RESET: '/api/system/onboard/reset',
    },

    // App Registry
    REGISTRY: {
      BASE: '/api/registry',
      HEALTH: '/api/registry/:appName/health',
    },

    // First-run device setup (no auth required)
    SETUP: {
      STATUS: '/api/setup/status',
      COMPLETE: '/api/setup/complete',
    },

    // Services management (SSH, FTP)
    SERVICES: {
      SSH_STATUS: '/api/services/ssh/status',
      SSH_TOGGLE: '/api/services/ssh/toggle',
      SSH_CONFIG: '/api/services/ssh/config',
      FTP_STATUS: '/api/services/ftp/status',
      FTP_TOGGLE: '/api/services/ftp/toggle',
      FTP_CONFIG: '/api/services/ftp/config',
    },

    // Schedule action catalog
    SCHEDULE_ACTIONS: '/api/remote-management/schedule/actions',
  },
};

// Helper function to build full API URLs
export const buildApiUrl = (endpoint) => {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
};

// Helper function to get full endpoint URL
export const getApiEndpoint = (path) => {
  // Navigate through nested object structure
  const keys = path.split('.');
  let endpoint = API_CONFIG.ENDPOINTS;
  
  for (const key of keys) {
    endpoint = endpoint[key];
    if (!endpoint) {
      throw new Error(`API endpoint not found: ${path}`);
    }
  }
  
  return buildApiUrl(endpoint);
};

// Helper function to build protocol-specific endpoints
export const getProtocolEndpoint = (protocolName, action = '') => {
  const base = getApiEndpoint('POLLING.PROTOCOLS');
  if (action) {
    return `${base}/${protocolName}/${action}`;
  }
  return `${base}/${protocolName}`;
};

// Helper function to build protocol config endpoints
export const getProtocolConfigEndpoint = (protocolName, configType = '') => {
  const base = `${getApiEndpoint('POLLING.PROTOCOLS')}/${protocolName}/config`;
  if (configType) {
    return `${base}/${configType}`;
  }
  return base;
};

// Export the base URL for backward compatibility
export const API_URL = API_CONFIG.BASE_URL;

// Helper to build per-app registry health URL
export const getRegistryHealthEndpoint = (appName) =>
  `${API_CONFIG.BASE_URL}/api/registry/${appName}/health`;

export default API_CONFIG; 