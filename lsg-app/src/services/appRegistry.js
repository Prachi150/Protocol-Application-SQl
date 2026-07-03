/**
 * App Registry Service
 * Central registry for installed protocol apps.
 * Reads app_manifest.json written by each protocol app's install.sh and persists
 * metadata in config/app-registry.json.
 *
 * NOTE: lsg-app does NOT manage Nginx configs.
 * Nginx is fully owned by each protocol app's install.sh / uninstall.sh.
 *
 * @module services/appRegistry
 */

const fs = require('fs').promises;
const path = require('path');

const REGISTRY_FILE = path.join(process.cwd(), 'config', 'app-registry.json');

/** In-memory cache of the registry. Keyed by appName. */
let registry = {};

/**
 * Load registry from disk. Creates an empty registry file if absent.
 */
async function init() {
    try {
        const raw = await fs.readFile(REGISTRY_FILE, 'utf8');
        registry = JSON.parse(raw);
        console.log(`[AppRegistry] Loaded ${Object.keys(registry).length} entries from ${REGISTRY_FILE}`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            registry = {};
            await _persist();
            console.log(`[AppRegistry] Created empty registry at ${REGISTRY_FILE}`);
        } else {
            throw new Error(`[AppRegistry] Failed to load registry: ${err.message}`);
        }
    }
}

/**
 * Register (create or update) an app from its manifest.
 * @param {string} appName - Must match manifest.appName
 * @param {Object} manifest - Parsed contents of app_manifest.json
 * @param {string} installPath - Absolute path to the app's install directory
 */
async function register(appName, manifest, installPath) {
    _validateManifest(manifest, appName);

    registry[appName] = {
        appName:              manifest.appName,
        displayName:          manifest.displayName,
        version:              manifest.version,
        description:          manifest.description || '',
        installPath:          installPath,
        installedAt:          new Date().toISOString(),
        port:                 manifest.port,
        uiEnabled:            manifest.uiEnabled === true,
        uiPath:               manifest.uiPath || null,
        apiPath:              manifest.apiPath || null,
        healthCheckPath:      manifest.healthCheckPath || '/health',
        runtime:              manifest.runtime || null,
        scripts:              manifest.scripts || {},
        startupDelaySeconds:  manifest.startupDelaySeconds || 3,
        requiresSudo:         manifest.requiresSudo === true,
        repo:                 manifest.repo || null,
    };

    await _persist();
    console.log(`[AppRegistry] Registered: ${appName} v${manifest.version}`);
    return registry[appName];
}

/**
 * Remove an app from the registry.
 * Called by lsg-app before uninstalling an app (Nginx cleanup is done by uninstall.sh).
 * @param {string} appName
 */
async function deregister(appName) {
    if (!registry[appName]) {
        console.log(`[AppRegistry] deregister: ${appName} not found in registry — skipping`);
        return;
    }
    delete registry[appName];
    await _persist();
    console.log(`[AppRegistry] Deregistered: ${appName}`);
}

/**
 * Get a single registry entry.
 * @param {string} appName
 * @returns {Object|null}
 */
function getEntry(appName) {
    return registry[appName] || null;
}

/**
 * Get all registry entries as a flat object keyed by appName.
 * @returns {Object}
 */
function getAll() {
    return { ...registry };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function _persist() {
    // Ensure config/ directory exists
    const configDir = path.dirname(REGISTRY_FILE);
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
}

function _validateManifest(manifest, appName) {
    const required = ['appName', 'displayName', 'version', 'port'];
    for (const field of required) {
        if (!manifest[field] && manifest[field] !== 0) {
            throw new Error(`[AppRegistry] manifest for ${appName} is missing required field: ${field}`);
        }
    }
    if (manifest.uiEnabled && !manifest.uiPath) {
        throw new Error(`[AppRegistry] manifest for ${appName} has uiEnabled=true but no uiPath`);
    }
}

module.exports = { init, register, deregister, getEntry, getAll };
