// Production: environment variables come from systemd EnvironmentFile directives
//   /etc/lsg-app/config.env     — safe non-secret config
//   /run/lsg-app/secrets.env    — decrypted at boot from /etc/lsg-app/secrets.env.age
// Development: dotenv loads from local .env (create from config/env.example)
require('dotenv').config();

const config = {
  // Server configuration
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // API configuration
  apiPrefix: '/api',
  
  // CORS configuration
  corsOrigin: process.env.CORS_ORIGIN || '*',
  
  // IoT Configuration
  iot: {
    maxPayloadSize: process.env.MAX_PAYLOAD_SIZE || '1mb',
    rateLimitPerDevice: parseInt(process.env.IOT_RATE_LIMIT_PER_DEVICE) || 100, // requests per minute
    requiredFields: ['deviceId', 'timestamp', 'data'],
    supportedDeviceTypes: ['sensor', 'actuator', 'gateway'],
    dataRetentionDays: parseInt(process.env.IOT_DATA_RETENTION_DAYS) || 30,
    
    // Security configuration
    security: {
      apiKeys: process.env.API_KEYS ? JSON.parse(process.env.API_KEYS) : [],
      rateLimit: {
        windowMs: 60 * 1000, // 1 minute
        max: 60 // limit each IP to 60 requests per windowMs
      },
      maxPayloadSize: '50kb'
    },
    
    // Data forwarding configuration
    forwarding: {
      // Can be 'mqtt', 'http', or 'both'
      method: process.env.IOT_FORWARDING_METHOD || 'mqtt',
      
      // Retry Configuration
      retry: {
        maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS) || 3,
        initialDelay: parseInt(process.env.RETRY_INITIAL_DELAY) || 1000, // ms
        maxDelay: parseInt(process.env.RETRY_MAX_DELAY) || 30000, // ms
        backoffFactor: parseFloat(process.env.RETRY_BACKOFF_FACTOR) || 2,
        // Whether to store failed messages for retry
        persistFailures: process.env.RETRY_PERSIST_FAILURES === 'true'
      },

      // Batch Processing Configuration
      batch: {
        enabled: process.env.BATCH_ENABLED === 'true',
        size: parseInt(process.env.BATCH_SIZE) || 100,
        flushInterval: parseInt(process.env.BATCH_FLUSH_INTERVAL) || 5000, // ms
        // Maximum time to wait for batch to fill before sending
        maxWaitTime: parseInt(process.env.BATCH_MAX_WAIT_TIME) || 30000, // ms
        // Whether to retry entire batch or individual messages
        retryIndividually: process.env.BATCH_RETRY_INDIVIDUALLY === 'true'
      },
      
      // MQTT Configuration
      mqtt: {
        enabled: process.env.MQTT_ENABLED === 'true',
        broker: process.env.MQTT_BROKER || 'mqtt://localhost:1883',
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        topic: process.env.MQTT_TOPIC || 'iot/data',
        // Template for MQTT payload
        payloadTemplate: process.env.MQTT_PAYLOAD_TEMPLATE || '{"device":"${deviceId}","type":"${deviceType}","data":${JSON.stringify(data)},"timestamp":"${timestamp}"}',
        qos: parseInt(process.env.MQTT_QOS) || 1,
        clientId: process.env.MQTT_CLIENT_ID || `iot-gateway-${Math.random().toString(16).slice(2)}`
      },
      
      // HTTP Configuration
      http: {
        enabled: process.env.HTTP_ENABLED === 'true',
        endpoint: process.env.HTTP_ENDPOINT || 'http://localhost:8080/data',
        method: process.env.HTTP_METHOD || 'POST',
        headers: process.env.HTTP_HEADERS ? JSON.parse(process.env.HTTP_HEADERS) : {
          'Content-Type': 'application/json'
        },
        // Template for HTTP payload
        payloadTemplate: process.env.HTTP_PAYLOAD_TEMPLATE || '{"deviceData":{"id":"${deviceId}","type":"${deviceType}"},"measurements":${JSON.stringify(data)},"timestamp":"${timestamp}"}'
      }
    }
  },
  jwt: {
    // No fallback — if JWT_SECRET is missing after setup, the service should fail loudly.
    // During setup mode (SETUP_COMPLETE=false) this is intentionally null;
    // setupGuard blocks all auth-requiring routes until setup is complete.
    secret: process.env.JWT_SECRET || null,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },
  
  // Admin authentication configuration
  admin: {
    // No fallbacks — these are written by the first-run setup wizard.
    // During setup mode (SETUP_COMPLETE=false), login is blocked by setupGuard.
    username: process.env.ADMIN_USERNAME || null,
    passwordHash: process.env.ADMIN_PASSWORD_HASH || null,
  },
  
  github: {
    // No fallback — required and entered via first-run setup wizard.
    token: process.env.GITHUB_TOKEN || null,
  }
};

// ── Startup validation ──────────────────────────────────────────────────────
// Only enforce after setup is complete (SETUP_COMPLETE=true).
// During first-run setup, the service starts without these values
// and setupGuard blocks all protected routes.
if (process.env.SETUP_COMPLETE === 'true') {
  const criticalSecrets = [
    ['JWT_SECRET',          config.jwt.secret],
    ['ADMIN_USERNAME',      config.admin.username],
    ['ADMIN_PASSWORD_HASH', config.admin.passwordHash],
    ['GITHUB_TOKEN',        config.github.token],
  ];

  const missing = criticalSecrets
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `FATAL: The following required secrets are missing after setup: ${missing.join(', ')}. ` +
      'Re-run the setup wizard or check /etc/lsg-app/secrets.env.age.'
    );
  }
}

// Legacy check for non-secret required configs
const requiredConfigs = ['nodeEnv'];
const missingConfigs = requiredConfigs.filter(key => !config[key]);
if (missingConfigs.length > 0) {
  throw new Error(`Missing required config: ${missingConfigs.join(', ')}`);
}

module.exports = config;