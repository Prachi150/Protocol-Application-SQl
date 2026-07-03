const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const config = require('../config');

const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);

// Ensure config directory exists
const CONFIG_DIR = path.join(process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'app-config.json');
const CONFIG_HISTORY_FILE = path.join(CONFIG_DIR, 'config-history.json');

class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.config = null;
    this.configHistory = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      // Ensure config directory exists
      try {
        await fs.promises.mkdir(CONFIG_DIR, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }

      // Check if config file exists
      const configExists = await fs.promises.access(CONFIG_FILE)
        .then(() => true)
        .catch(() => false);

      if (!configExists) {
        // If file doesn't exist, create it with values from src/config/index.js
        const initialConfig = {
          iot: {
            maxPayloadSize: config.iot.maxPayloadSize,
            rateLimitPerDevice: config.iot.rateLimitPerDevice,
            requiredFields: config.iot.requiredFields,
            supportedDeviceTypes: config.iot.supportedDeviceTypes,
            dataRetentionDays: config.iot.dataRetentionDays,
            
            security: {
              apiKeys: config.iot.security.apiKeys || [],
              apiKeyDetails: config.iot.security.apiKeyDetails || {},
              rateLimit: config.iot.security.rateLimit,
              maxPayloadSize: config.iot.security.maxPayloadSize
            },
            
            forwarding: {
              method: config.iot.forwarding.method,
              
              retry: config.iot.forwarding.retry,
              batch: config.iot.forwarding.batch,
              
              mqtt: {
                enabled: config.iot.forwarding.mqtt.enabled,
                broker: config.iot.forwarding.mqtt.broker,
                username: config.iot.forwarding.mqtt.username,
                password: config.iot.forwarding.mqtt.password,
                topic: config.iot.forwarding.mqtt.topic,
                payloadTemplate: config.iot.forwarding.mqtt.payloadTemplate,
                qos: config.iot.forwarding.mqtt.qos,
                clientId: config.iot.forwarding.mqtt.clientId
              },
              http: {
                enabled: config.iot.forwarding.http.enabled,
                endpoint: config.iot.forwarding.http.endpoint,
                method: config.iot.forwarding.http.method,
                headers: config.iot.forwarding.http.headers,
                payloadTemplate: config.iot.forwarding.http.payloadTemplate
              }
            }
          },
          jwt: {
            secret: config.jwt.secret,
            expiresIn: config.jwt.expiresIn
          },
          github: {
            token: config.github.token
          },
          vpn: null,
          onboarding: null
        };

        this.config = initialConfig;
        await this.persistConfig();
        console.log('Created new configuration file with values from src/config/index.js');
      } else {
        // If file exists, load it and merge with default config to ensure all fields exist
        const configData = await readFileAsync(CONFIG_FILE, 'utf8');
        const existingConfig = JSON.parse(configData);
        
        // Deep merge with default config to ensure all fields exist
        const mergedConfig = {
          iot: {
            maxPayloadSize: existingConfig.iot?.maxPayloadSize || config.iot.maxPayloadSize,
            rateLimitPerDevice: existingConfig.iot?.rateLimitPerDevice || config.iot.rateLimitPerDevice,
            requiredFields: existingConfig.iot?.requiredFields || config.iot.requiredFields,
            supportedDeviceTypes: existingConfig.iot?.supportedDeviceTypes || config.iot.supportedDeviceTypes,
            dataRetentionDays: existingConfig.iot?.dataRetentionDays || config.iot.dataRetentionDays,
            
            security: {
              apiKeys: existingConfig.iot?.security?.apiKeys || [],
              apiKeyDetails: existingConfig.iot?.security?.apiKeyDetails || {},
              rateLimit: existingConfig.iot?.security?.rateLimit || config.iot.security.rateLimit,
              maxPayloadSize: existingConfig.iot?.security?.maxPayloadSize || config.iot.security.maxPayloadSize
            },
            
            forwarding: {
              method: existingConfig.iot?.forwarding?.method || config.iot.forwarding.method,
              
              retry: existingConfig.iot?.forwarding?.retry || config.iot.forwarding.retry,
              batch: existingConfig.iot?.forwarding?.batch || config.iot.forwarding.batch,
              
              mqtt: {
                enabled: existingConfig.iot?.forwarding?.mqtt?.enabled ?? config.iot.forwarding.mqtt.enabled,
                broker: existingConfig.iot?.forwarding?.mqtt?.broker || config.iot.forwarding.mqtt.broker,
                username: existingConfig.iot?.forwarding?.mqtt?.username || config.iot.forwarding.mqtt.username,
                password: existingConfig.iot?.forwarding?.mqtt?.password || config.iot.forwarding.mqtt.password,
                topic: existingConfig.iot?.forwarding?.mqtt?.topic || config.iot.forwarding.mqtt.topic,
                payloadTemplate: existingConfig.iot?.forwarding?.mqtt?.payloadTemplate || config.iot.forwarding.mqtt.payloadTemplate,
                qos: existingConfig.iot?.forwarding?.mqtt?.qos || config.iot.forwarding.mqtt.qos,
                clientId: existingConfig.iot?.forwarding?.mqtt?.clientId || config.iot.forwarding.mqtt.clientId
              },
              http: {
                enabled: existingConfig.iot?.forwarding?.http?.enabled ?? config.iot.forwarding.http.enabled,
                endpoint: existingConfig.iot?.forwarding?.http?.endpoint || config.iot.forwarding.http.endpoint,
                method: existingConfig.iot?.forwarding?.http?.method || config.iot.forwarding.http.method,
                headers: existingConfig.iot?.forwarding?.http?.headers || config.iot.forwarding.http.headers,
                payloadTemplate: existingConfig.iot?.forwarding?.http?.payloadTemplate || config.iot.forwarding.http.payloadTemplate
              }
            }
          },
          jwt: {
            secret: existingConfig.jwt?.secret || config.jwt.secret,
            expiresIn: existingConfig.jwt?.expiresIn || config.jwt.expiresIn
          },
          github: {
            token: existingConfig.github?.token || config.github.token
          },
          vpn: existingConfig.vpn || null,
          onboarding: existingConfig.onboarding || null
        };

        this.config = mergedConfig;
        await this.persistConfig();
        console.log('Loaded and updated existing configuration from app-config.json');
      }

      // Load or create history
      try {
        const historyData = await fs.promises.readFile(CONFIG_HISTORY_FILE, 'utf8');
        this.configHistory = JSON.parse(historyData);
      } catch (error) {
        if (error.code === 'ENOENT') {
          this.configHistory = [];
          await this.persistHistory();
        } else {
          throw error;
        }
      }

      this.initialized = true;
      return this.config;
    } catch (error) {
      console.error('Failed to initialize configuration:', error);
      throw error;
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.init();
    }
  }

  async persistConfig() {
    try {
      // Ensure config directory exists
      await fs.promises.mkdir(CONFIG_DIR, { recursive: true });
      
      console.log('Persisting configuration:', JSON.stringify(this.config, null, 2));
      await writeFileAsync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
      console.log('Configuration persisted to disk');
    } catch (error) {
      console.error('Error persisting configuration:', error);
      throw error;
    }
  }

  async persistHistory() {
    try {
      await writeFileAsync(CONFIG_HISTORY_FILE, JSON.stringify(this.configHistory, null, 2), 'utf8');
    } catch (error) {
      console.error('Error persisting history:', error);
      throw error;
    }
  }

  async getConfig() {
    await this.ensureInitialized();
    return this.config;
  }

  async updateMQTTConfig(mqttConfig) {
    await this.ensureInitialized();

    try {
      const oldConfig = { ...this.config.iot.forwarding.mqtt };
      
      // Ensure enabled flag is preserved if not explicitly set
      if (typeof mqttConfig.enabled === 'undefined') {
        mqttConfig.enabled = oldConfig.enabled;
      }

      // Create new config preserving existing fields if not provided
      const newConfig = {
        enabled: mqttConfig.enabled ?? oldConfig.enabled ?? true,
        broker: mqttConfig.broker ?? oldConfig.broker,
        username: mqttConfig.username ?? oldConfig.username,
        password: mqttConfig.password ?? oldConfig.password,
        topic: mqttConfig.topic ?? oldConfig.topic,
        payloadTemplate: mqttConfig.payloadTemplate ?? oldConfig.payloadTemplate,
        qos: mqttConfig.qos ?? oldConfig.qos ?? 1,
        clientId: mqttConfig.clientId ?? oldConfig.clientId ?? `iot-gateway-${Math.random().toString(16).slice(2)}`
      };

      // Update configuration
      this.config.iot.forwarding.mqtt = newConfig;

      // Add to history
      this.configHistory.push({
        type: 'mqtt',
        timestamp: new Date().toISOString(),
        oldConfig,
        newConfig: this.config.iot.forwarding.mqtt
      });

      // Persist changes
      await Promise.all([
        this.persistConfig(),
        this.persistHistory()
      ]);

      // Emit change event
      this.emit('mqttConfigChanged', { 
        oldConfig, 
        newConfig: this.config.iot.forwarding.mqtt 
      });

      console.log('MQTT configuration updated:', this.config.iot.forwarding.mqtt);
      return this.config.iot.forwarding.mqtt;
    } catch (error) {
      console.error('Error updating MQTT configuration:', error);
      throw error;
    }
  }

  async updateHTTPConfig(httpConfig) {
    await this.ensureInitialized();

    try {
      // Ensure the configuration structure exists
      if (!this.config.iot) this.config.iot = {};
      if (!this.config.iot.forwarding) this.config.iot.forwarding = {};
      if (!this.config.iot.forwarding.http) {
        this.config.iot.forwarding.http = {
          enabled: false,
          endpoint: 'http://localhost:8080/data',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          payloadTemplate: '{"deviceData":{"id":"${deviceId}","type":"${deviceType}"},"measurements":${JSON.stringify(data)},"timestamp":"${timestamp}"}'
        };
      }

      console.log('Current HTTP config:', JSON.stringify(this.config.iot.forwarding.http, null, 2));
      console.log('Updating with:', JSON.stringify(httpConfig, null, 2));
      
      // Store old config for history
      const oldConfig = { ...this.config.iot.forwarding.http };
      
      // Update configuration while preserving existing fields
      const newConfig = {
        ...oldConfig,
        ...httpConfig,
        // Preserve headers if not provided in new config
        headers: httpConfig.headers || oldConfig.headers || {
          'Content-Type': 'application/json'
        }
      };

      console.log('New config before update:', JSON.stringify(newConfig, null, 2));
      
      // Update the configuration
      this.config.iot.forwarding.http = newConfig;

      // Add to history
      this.configHistory.push({
        type: 'http',
        timestamp: new Date().toISOString(),
        oldConfig,
        newConfig
      });

      // Persist changes
      await Promise.all([
        this.persistConfig(),
        this.persistHistory()
      ]);

      // Emit change event
      this.emit('httpConfigChanged', { 
        oldConfig, 
        newConfig 
      });

      console.log('HTTP configuration updated:', JSON.stringify(newConfig, null, 2));
      return newConfig;
    } catch (error) {
      console.error('Error updating HTTP configuration:', error);
      throw error;
    }
  }

  async updateForwardingMethod(method) {
    await this.ensureInitialized();

    if (!['mqtt', 'http', 'both'].includes(method)) {
      throw new Error('Invalid forwarding method. Must be "mqtt", "http", or "both"');
    }

    try {
      const oldMethod = this.config.iot.forwarding.method;
      
      // Update method
      this.config.iot.forwarding.method = method;

      // Add to history
      this.configHistory.push({
        type: 'method',
        timestamp: new Date().toISOString(),
        oldValue: oldMethod,
        newValue: method
      });

      // Persist changes
      await Promise.all([
        this.persistConfig(),
        this.persistHistory()
      ]);

      // Emit change event
      this.emit('forwardingMethodChanged', { oldMethod, newMethod: method });

      console.log('Forwarding method updated:', method);
      return method;
    } catch (error) {
      console.error('Error updating forwarding method:', error);
      throw error;
    }
  }

  async getConfigHistory() {
    await this.ensureInitialized();
    return this.configHistory;
  }

  // API Key Management
  async getApiKeys() {
    await this.ensureInitialized();
    const config = await this.getConfig();
    return config.iot?.security?.apiKeys || [];
  }

  async addApiKey(key, description) {
    await this.ensureInitialized();
    
    // Initialize security structure if it doesn't exist
    if (!this.config.iot) this.config.iot = {};
    if (!this.config.iot.security) this.config.iot.security = {};
    if (!this.config.iot.security.apiKeys) this.config.iot.security.apiKeys = [];
    if (!this.config.iot.security.apiKeyDetails) this.config.iot.security.apiKeyDetails = {};

    // Check if key already exists
    if (this.config.iot.security.apiKeys.includes(key)) {
      throw new Error('API key already exists');
    }

    // Add the key and its details
    this.config.iot.security.apiKeys.push(key);
    this.config.iot.security.apiKeyDetails[key] = {
      description,
      createdAt: new Date().toISOString()
    };

    // Add to history
    this.configHistory.push({
      type: 'api_key_added',
      timestamp: new Date().toISOString(),
      key,
      details: this.config.iot.security.apiKeyDetails[key]
    });

    // Save the updated configuration and history
    await Promise.all([
      this.persistConfig(),
      this.persistHistory()
    ]);
    
    return {
      key,
      details: this.config.iot.security.apiKeyDetails[key]
    };
  }

  async removeApiKey(key) {
    await this.ensureInitialized();
    const config = await this.getConfig();
    
    if (!config.iot?.security?.apiKeys) {
      throw new Error('No API keys configured');
    }

    const keyIndex = config.iot.security.apiKeys.indexOf(key);
    if (keyIndex === -1) {
      throw new Error('API key not found');
    }

    // Remove the key and its details
    config.iot.security.apiKeys.splice(keyIndex, 1);
    delete config.iot.security.apiKeyDetails[key];

    // Save the updated configuration
    await this.persistConfig();
    
    return true;
  }

  async getApiKeyDetails(key) {
    await this.ensureInitialized();
    const config = await this.getConfig();
    const details = config.iot?.security?.apiKeyDetails?.[key];
    
    if (!details) {
      return null;
    }
    
    return {
      key,
      details
    };
  }

  generateApiKey() {
    return crypto.randomBytes(16).toString('hex');
  }

  async updateHTTPHeaders(headers, operation = 'set') {
    await this.ensureInitialized();

    try {
      const oldHeaders = { ...this.config.iot.forwarding.http.headers };
      
      // Update headers based on operation
      switch (operation) {
        case 'set':
          this.config.iot.forwarding.http.headers = { ...headers };
          break;
        case 'add':
          this.config.iot.forwarding.http.headers = {
            ...this.config.iot.forwarding.http.headers,
            ...headers
          };
          break;
        case 'remove':
          const newHeaders = { ...this.config.iot.forwarding.http.headers };
          Object.keys(headers).forEach(key => delete newHeaders[key]);
          this.config.iot.forwarding.http.headers = newHeaders;
          break;
      }

      // Add to history
      this.configHistory.push({
        type: 'http_headers',
        timestamp: new Date().toISOString(),
        operation,
        oldHeaders,
        newHeaders: this.config.iot.forwarding.http.headers
      });

      // Persist changes
      await Promise.all([
        this.persistConfig(),
        this.persistHistory()
      ]);

      // Emit change event
      this.emit('httpConfigChanged', {
        oldConfig: { ...this.config.iot.forwarding.http, headers: oldHeaders },
        newConfig: this.config.iot.forwarding.http
      });

      console.log('HTTP headers updated:', this.config.iot.forwarding.http.headers);
      return this.config.iot.forwarding.http.headers;
    } catch (error) {
      console.error('Error updating HTTP headers:', error);
      throw error;
    }
  }

  validateMQTTConfig(config) {
    const errors = [];
    
    if (config.broker && typeof config.broker !== 'string') {
      errors.push('Broker must be a string');
    }
    
    if (config.topic && typeof config.topic !== 'string') {
      errors.push('Topic must be a string');
    }
    
    if (config.qos && ![0, 1, 2].includes(Number(config.qos))) {
      errors.push('QoS must be 0, 1, or 2');
    }

    return errors;
  }

  validateHTTPConfig(config) {
    const errors = [];
    
    // Check if config is an object
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      errors.push('Configuration must be an object');
      return errors;
    }

    // Validate endpoint if provided
    if (config.endpoint !== undefined) {
      if (typeof config.endpoint !== 'string') {
        errors.push('Endpoint must be a string');
      } else if (!config.endpoint.startsWith('http://') && !config.endpoint.startsWith('https://')) {
        errors.push('Endpoint must start with http:// or https://');
      }
    }
    
    // Validate method if provided
    if (config.method !== undefined) {
      if (typeof config.method !== 'string') {
        errors.push('Method must be a string');
      } else if (!['GET', 'POST', 'PUT', 'PATCH'].includes(config.method.toUpperCase())) {
        errors.push('Method must be one of: GET, POST, PUT, PATCH');
      }
    }

    // Validate enabled if provided
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
      errors.push('Enabled must be a boolean');
    }

    // Validate headers if provided
    if (config.headers !== undefined) {
      if (typeof config.headers !== 'object' || Array.isArray(config.headers)) {
        errors.push('Headers must be an object');
      } else {
        // Validate header values
        Object.entries(config.headers).forEach(([key, value]) => {
          if (typeof value !== 'string') {
            errors.push(`Header value for '${key}' must be a string`);
          }
        });
      }
    }

    // Validate payloadTemplate if provided
    if (config.payloadTemplate !== undefined && typeof config.payloadTemplate !== 'string') {
      errors.push('Payload template must be a string');
    }

    return errors;
  }

  validateHTTPHeaders(headers, operation = 'set') {
    const errors = [];

    if (typeof headers !== 'object' || Array.isArray(headers)) {
      errors.push('Headers must be an object');
    }

    if (!['set', 'add', 'remove'].includes(operation)) {
      errors.push('Operation must be one of: set, add, remove');
    }

    return errors;
  }
}

// Create singleton instance
const configManager = new ConfigManager();

module.exports = configManager; 