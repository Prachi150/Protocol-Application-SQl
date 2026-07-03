/**
 * Master MQTT Client for lsg-app.
 *
 * The single, always-on MQTT connection for all ioadmin communication.
 * Uses .env broker credentials (NOT configurable via API).
 *
 * Responsibilities:
 * - Listens for commands from ioadmin (VPN toggle, etc.)
 * - Provides publishMessage() for heartbeat
 * - Provides publishAndWait() for request-response (onboarding)
 *
 * This is separate from the configurable data forwarder MQTT client
 * (dataForwarder.js) which handles IoT data forwarding.
 */

const mqtt = require('mqtt');
const configManager = require('./configManager');
const vpnService = require('./vpnService');

let mqttClient = null;
let currentToken = null;
const pendingResponses = {}; // correlationId or topic -> { resolve, reject, timer }

/**
 * Initialize the Master MQTT Client.
 * Connects on startup using .env broker credentials.
 * Subscribes to command topics once a token is known (after onboarding).
 */
const initMasterMqttClient = async () => {
    // Don't reconnect if already connected
    if (mqttClient && mqttClient.connected) {
        return;
    }

    const brokerHost = process.env.MASTER_MQTT_HOST || 'hap.faclon.com';
    const brokerPort = process.env.MASTER_MQTT_PORT || 1883;

    if (!process.env.MASTER_MQTT_USERNAME) {
        console.log('[MasterMqtt] No MASTER_MQTT_USERNAME configured — skipping init');
        return;
    }

    const brokerUrl = 'mqtt://' + brokerHost + ':' + brokerPort;
    const options = {
        clientId: 'lsg_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8),
        username: process.env.MASTER_MQTT_USERNAME || undefined,
        password: process.env.MASTER_MQTT_PASSWORD || undefined,
        reconnectPeriod: 5000,
        connectTimeout: 10000
    };

    mqttClient = mqtt.connect(brokerUrl, options);

    mqttClient.on('connect', () => {
        console.log('[MasterMqtt] Connected to MQTT broker');

        // If already onboarded, subscribe to command topics
        subscribeToCommandTopics();
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            const parts = topic.split('/');

            // Check for command: lsg/<token>/cmd/<action>
            if (parts.length >= 4 && parts[2] === 'cmd') {
                handleCommand(parts[3], data);
                return;
            }

            // Check for pending response by topic
            const pending = pendingResponses[topic];
            if (pending) {
                clearTimeout(pending.timer);
                delete pendingResponses[topic];
                pending.resolve(data);
                return;
            }
        } catch (err) {
            console.error('[MasterMqtt] Error processing message:', err.message);
        }
    });

    mqttClient.on('error', (err) => {
        console.error('[MasterMqtt] MQTT error:', err.message);
    });

    mqttClient.on('offline', () => {
        console.warn('[MasterMqtt] MQTT offline');
    });

    mqttClient.on('reconnect', () => {
        console.log('[MasterMqtt] MQTT reconnecting...');
    });

    console.log('[MasterMqtt] Master MQTT Client initialized');
};

/**
 * Subscribe to command topics for this asset (called after onboarding).
 */
const subscribeToCommandTopics = async () => {
    if (!mqttClient || !mqttClient.connected) return;

    const config = await configManager.getConfig();
    const onboarding = config.onboarding;

    if (!onboarding || !onboarding.token) return;

    currentToken = onboarding.token;
    var cmdTopic = 'lsg/' + currentToken + '/cmd/#';

    mqttClient.subscribe(cmdTopic, { qos: 1 }, (err) => {
        if (err) console.error('[MasterMqtt] Subscribe failed:', err.message);
        else console.log('[MasterMqtt] Subscribed to', cmdTopic);
    });
};

/**
 * Handle an incoming command from ioadmin.
 */
const handleCommand = async (action, data) => {
    var correlationId = data.correlationId;
    console.log('[MasterMqtt] Received command:', action, 'correlationId:', correlationId);

    if (action === 'vpn') {
        await handleVpnCommand(data);
    } else if (action === 'restart') {
        await handleRestartCommand(data);
    } else {
        console.warn('[MasterMqtt] Unknown action:', action);
        publishResponse(action, {
            correlationId: correlationId,
            success: false,
            error: 'Unknown action: ' + action
        });
    }
};

/**
 * Handle VPN toggle command.
 */
const handleVpnCommand = async (data) => {
    var correlationId = data.correlationId;
    var enable = data.payload && data.payload.enable;

    try {
        if (enable) {
            await vpnService.enable();
            console.log('[MasterMqtt] VPN enabled');
        } else {
            await vpnService.disable();
            console.log('[MasterMqtt] VPN disabled');
        }

        publishResponse('vpn', {
            correlationId: correlationId,
            success: true,
            vpnEnabled: enable
        });
    } catch (err) {
        console.error('[MasterMqtt] VPN toggle failed:', err.message);
        publishResponse('vpn', {
            correlationId: correlationId,
            success: false,
            error: err.message
        });
    }
};

/**
 * Handle restart command from ioadmin.
 */
const handleRestartCommand = async (data) => {
    var correlationId = data.correlationId;
    var payload = data.payload || {};

    try {
        // Send acknowledgment BEFORE restarting (system won't be able to respond after)
        publishResponse('restart', {
            correlationId: correlationId,
            success: true,
            message: 'Restart initiated'
        });

        // Small delay to ensure the MQTT response is sent
        await new Promise(function (resolve) { setTimeout(resolve, 1000); });

        var systemService = require('./systemService');
        await systemService.restartSystem({
            type: payload.type || 'immediate',
            force: payload.force !== undefined ? payload.force : true,
            delay: payload.delay || undefined
        });
    } catch (err) {
        console.error('[MasterMqtt] Restart failed:', err.message);
        publishResponse('restart', {
            correlationId: correlationId,
            success: false,
            error: err.message
        });
    }
};

/**
 * Publish a response to a command.
 */
const publishResponse = (action, data) => {
    if (!mqttClient || !currentToken) return;

    var topic = 'lsg/' + currentToken + '/res/' + action;
    mqttClient.publish(topic, JSON.stringify(data), { qos: 1 }, (err) => {
        if (err) console.error('[MasterMqtt] Failed to publish response:', err.message);
    });
};

/**
 * Publish a message to an arbitrary topic (used by heartbeat service).
 */
const publishMessage = (topic, data) => {
    if (!mqttClient) {
        console.warn('[MasterMqtt] Cannot publish — MQTT not connected');
        return;
    }

    mqttClient.publish(topic, JSON.stringify(data), { qos: 0 }, (err) => {
        if (err) console.error('[MasterMqtt] Failed to publish to', topic, ':', err.message);
    });
};

/**
 * Publish a message and wait for a response on a specific topic.
 * Used for onboarding request-response via MQTT.
 *
 * @param {String} publishTopic - Topic to publish the request to
 * @param {Object} data - Request data
 * @param {String} responseTopic - Topic to subscribe to for the response
 * @param {Number} timeoutMs - Timeout in ms
 * @returns {Promise<Object>} Response data
 */
const publishAndWait = (publishTopic, data, responseTopic, timeoutMs) => {
    if (!mqttClient) {
        return Promise.reject(new Error('MQTT not connected'));
    }

    timeoutMs = timeoutMs || 30000;

    return new Promise(function (resolve, reject) {
        // Subscribe to response topic
        mqttClient.subscribe(responseTopic, { qos: 1 }, function (err) {
            if (err) {
                return reject(new Error('Failed to subscribe to response topic: ' + err.message));
            }

            // Set up timeout
            var timer = setTimeout(function () {
                delete pendingResponses[responseTopic];
                mqttClient.unsubscribe(responseTopic);
                reject(new Error('Request timed out after ' + timeoutMs + 'ms'));
            }, timeoutMs);

            // Register pending response
            pendingResponses[responseTopic] = {
                resolve: function (responseData) {
                    mqttClient.unsubscribe(responseTopic);
                    resolve(responseData);
                },
                reject: reject,
                timer: timer
            };

            // Publish the request
            mqttClient.publish(publishTopic, JSON.stringify(data), { qos: 1 }, function (pubErr) {
                if (pubErr) {
                    clearTimeout(timer);
                    delete pendingResponses[responseTopic];
                    mqttClient.unsubscribe(responseTopic);
                    reject(new Error('Failed to publish: ' + pubErr.message));
                }
            });
        });
    });
};

/**
 * Check if the MQTT client is connected.
 */
const isConnected = () => {
    return mqttClient && mqttClient.connected;
};

module.exports = {
    initMasterMqttClient: initMasterMqttClient,
    publishMessage: publishMessage,
    publishAndWait: publishAndWait,
    isConnected: isConnected,
    subscribeToCommandTopics: subscribeToCommandTopics
};
