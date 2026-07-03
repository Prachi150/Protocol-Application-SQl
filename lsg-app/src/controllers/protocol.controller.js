const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-stringify/sync');
const parse = require('csv-parse/sync');
const axios = require('axios');
const appRegistry = require('../services/appRegistry');

const INSTALL_DIR = path.join(process.cwd(), 'apps');
const PROTOCOLS_CONFIG_FILE = path.join(process.cwd(), 'config', 'protocols-config.json');

// Track installation status for each protocol/app
const installationStatus = {};

// Track uninstallation status for each app
const uninstallStatus = {};

/**
 * Load the known-protocols list from config/protocols-config.json.
 * Returns an empty object if the file does not exist.
 */
async function loadProtocolsConfig() {
    try {
        const raw = await fs.readFile(PROTOCOLS_CONFIG_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw new Error(`Failed to load protocols config: ${err.message}`);
    }
}

/**
 * Resolve a protocol/app identifier to its runtime config.
 * Resolution order:
 *   1. protocols-config.json key  (e.g. "opcua")
 *   2. protocols-config.json appName match  (e.g. "opcua-client")
 *   3. App registry  (dynamically installed apps)
 *
 * protocolPath is taken from the registry installPath when available,
 * otherwise derived from the standard apps/<appName> convention.
 */
async function resolveProtocolConfig(identifier) {
    const protocolsConfig = await loadProtocolsConfig();

    // 1. Known protocol by key
    if (protocolsConfig[identifier]) {
        const config = protocolsConfig[identifier];
        const registryEntry = appRegistry.getEntry(config.appName);
        return {
            ...config,
            key: identifier,
            protocolPath: registryEntry
                ? registryEntry.installPath
                : path.join(INSTALL_DIR, config.appName),
        };
    }

    // 2. Known protocol by appName
    for (const [key, config] of Object.entries(protocolsConfig)) {
        if (config.appName === identifier) {
            const registryEntry = appRegistry.getEntry(config.appName);
            return {
                ...config,
                key,
                protocolPath: registryEntry
                    ? registryEntry.installPath
                    : path.join(INSTALL_DIR, config.appName),
            };
        }
    }

    // 3. Dynamic app — registry is the source of truth
    const registryEntry = appRegistry.getEntry(identifier);
    if (registryEntry) {
        return {
            repo: null,
            appName: identifier,
            description: registryEntry.description || identifier,
            key: identifier,
            protocolPath: registryEntry.installPath,
        };
    }

    return null;
}

/**
 * Check whether an app is currently running by executing its scripts/status.sh.
 * Exit code 0 → running. Any non-zero exit / error → not running.
 */
async function getAppRunningStatus(protocolPath) {
    try {
        const scriptPath = path.join(protocolPath, 'scripts', 'status.sh');
        await execAsync(`bash "${scriptPath}"`, { cwd: protocolPath });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the ISO timestamp of when an app's service last became active.
 * Calls the app's scripts/uptime.sh which prints a Unix epoch integer.
 * Returns null if the script is absent, fails, or returns invalid output.
 */
async function getAppStartedAt(config) {
    try {
        const { scriptPath, cwd } = resolveScriptPath(config, 'uptime');
        const { stdout } = await execAsync(`bash "${scriptPath}"`, { cwd });
        const epoch = parseInt(stdout.trim(), 10);
        if (!epoch || isNaN(epoch)) return null;
        return new Date(epoch * 1000).toISOString();
    } catch {
        return null;
    }
}

/**
 * Resolve the path to a lifecycle script (start/stop/restart/logs/status).
 * Prefers manifest-declared script paths from the registry, falls back to
 * the scripts/<action>.sh convention.
 */
function resolveScriptPath(config, action) {
    const registryEntry = appRegistry.getEntry(config.appName);
    if (registryEntry && registryEntry.scripts && registryEntry.scripts[action]) {
        const scriptEntry = registryEntry.scripts[action];
        // scripts[action] may be a plain string path or an object { path, requiresSudo }
        const relativePath = typeof scriptEntry === 'string' ? scriptEntry : scriptEntry.path;
        const requiresSudo = typeof scriptEntry === 'object' && scriptEntry.requiresSudo === true;
        return {
            scriptPath: path.join(registryEntry.installPath, relativePath),
            cwd: registryEntry.installPath,
            requiresSudo,
        };
    }
    return {
        scriptPath: path.join(config.protocolPath, 'scripts', `${action}.sh`),
        cwd: config.protocolPath,
        requiresSudo: false,
    };
}

// ── List protocols ────────────────────────────────────────────────────────────

const listProtocols = async (req, res) => {
    try {
        const protocolsConfig = await loadProtocolsConfig();
        const registryEntries = appRegistry.getAll();
        const installedProtocols = {};

        // 1. All known protocols from config file (always shown, installed or not)
        for (const [protocol, config] of Object.entries(protocolsConfig)) {
            const registryEntry = registryEntries[config.appName] || null;
            const installed = !!registryEntry;
            const running = installed
                ? await getAppRunningStatus(registryEntry.installPath)
                : false;

            installedProtocols[protocol] = {
                ...config,
                installed,
                running,
                registry: registryEntry ? {
                    displayName: registryEntry.displayName,
                    version:     registryEntry.version,
                    port:        registryEntry.port,
                    uiEnabled:   registryEntry.uiEnabled,
                    uiPath:      registryEntry.uiPath,
                    apiPath:     registryEntry.apiPath,
                    installedAt: registryEntry.installedAt,
                    runtime:     registryEntry.runtime,
                    startedAt:   running ? await getAppStartedAt(config) : null,
                } : null,
            };
        }

        // 2. Dynamic apps in registry that are not in protocols-config
        const knownAppNames = Object.values(protocolsConfig).map(c => c.appName);
        for (const [appName, entry] of Object.entries(registryEntries)) {
            if (knownAppNames.includes(appName)) continue;

            const dynConfig = { appName, protocolPath: entry.installPath };
            const running = await getAppRunningStatus(entry.installPath);
            installedProtocols[appName] = {
                repo:        entry.repo || null,
                appName,
                description: entry.description || appName,
                installed:   true,
                running,
                registry: {
                    displayName: entry.displayName,
                    version:     entry.version,
                    port:        entry.port,
                    uiEnabled:   entry.uiEnabled,
                    uiPath:      entry.uiPath,
                    apiPath:     entry.apiPath,
                    installedAt: entry.installedAt,
                    runtime:     entry.runtime,
                    startedAt:   running ? await getAppStartedAt(dynConfig) : null,
                },
            };
        }

        res.json({ protocols: installedProtocols });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── Installation ──────────────────────────────────────────────────────────────

async function performInstallation(key, config, token, toolId, adminUrl) {
    try {
        const protocolPath = path.join(INSTALL_DIR, config.appName);

        installationStatus[key] = {
            status: 'installing',
            step: 'starting',
            timestamp: new Date().toISOString(),
            logs: [],
        };

        // Backup existing config files if present
        let configBackup = null;
        let paramsBackup = null;
        try {
            configBackup = await fs.readFile(path.join(protocolPath, 'config.csv'), 'utf-8');
            installationStatus[key].step = 'backed_up_config';
        } catch { /* not present */ }
        try {
            paramsBackup = await fs.readFile(path.join(protocolPath, 'sys_parameters.json'), 'utf-8');
            installationStatus[key].step = 'backed_up_params';
        } catch { /* not present */ }

        // Create apps directory if it doesn't exist
        await fs.mkdir(INSTALL_DIR, { recursive: true });
        installationStatus[key].step = 'created_directory';

        // Remove existing directory contents (preserve the directory itself)
        try {
            const files = await fs.readdir(protocolPath);
            for (const file of files) {
                await fs.rm(path.join(protocolPath, file), { recursive: true, force: true });
            }
            installationStatus[key].step = 'cleaned_directory';
        } catch { /* directory doesn't exist yet */ }

        // Clone repository
        let cloneUrl;
        if (config.repo.startsWith('https://')) {
            cloneUrl = config.repo.replace('https://', `https://${token}@`);
            if (!cloneUrl.endsWith('.git')) cloneUrl += '.git';
        } else {
            cloneUrl = `https://${token}@github.com/${config.repo}.git`;
        }
        await execAsync(`git clone "${cloneUrl}" "${protocolPath}"`);
        installationStatus[key].step = 'cloned_repository';

        // Validate required app structure (app_manifest.json is generated by install.sh, not checked here)
        const requiredFiles = [
            'scripts/install.sh',
            'scripts/uninstall.sh',
        ];
        const missing = [];
        for (const rel of requiredFiles) {
            try {
                await fs.access(path.join(protocolPath, rel));
            } catch {
                missing.push(rel);
            }
        }
        if (missing.length > 0) {
            throw new Error(
                `App is missing required files: ${missing.join(', ')}. ` +
                'Ensure the repository contains a scripts/ folder with install.sh and uninstall.sh.'
            );
        }
        installationStatus[key].step = 'validated_structure';

        // Restore config files
        if (configBackup) {
            await fs.writeFile(path.join(protocolPath, 'config.csv'), configBackup);
        }
        if (paramsBackup) {
            await fs.writeFile(path.join(protocolPath, 'sys_parameters.json'), paramsBackup);
        }
        installationStatus[key].step = 'restored_configs';

        // Fix Windows line endings and make scripts executable
        await execAsync(
            'sed -i "s/\\r$//" scripts/*.sh 2>/dev/null || true; chmod +x scripts/*.sh 2>/dev/null || true',
            { cwd: protocolPath }
        );
        installationStatus[key].step = 'installing_dependencies';

        // Run the app's install script — stream stdout/stderr chunks for live log display.
        // exec (shell-based) is used intentionally: it keeps stdin connected to the shell so
        // interactive prompts inside install.sh get EOF rather than blocking on an open pipe.
        const appendChunk = (chunk) => {
            chunk.toString().split('\n')
                .map(l => l.trimEnd())
                .filter(Boolean)
                .forEach(l => installationStatus[key].logs.push(l));
        };
        const child = exec(
            `sudo bash "${path.join(protocolPath, 'scripts', 'install.sh')}"`,
            { cwd: protocolPath }
        );
        child.stdout.on('data', appendChunk);
        child.stderr.on('data', appendChunk);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error('install.sh timed out after 5 minutes'));
            }, 300000);
            child.on('close', code => {
                clearTimeout(timer);
                code === 0 ? resolve() : reject(new Error(`install.sh exited with code ${code}`));
            });
            child.on('error', err => { clearTimeout(timer); reject(err); });
        });
        installationStatus[key].step = 'started_application';

        // Read app_manifest.json generated by install.sh — fail hard if missing or invalid
        let manifest;
        const manifestPath = path.join(protocolPath, 'app_manifest.json');
        try {
            const manifestRaw = await fs.readFile(manifestPath, 'utf8');
            manifest = JSON.parse(manifestRaw);
        } catch (manifestErr) {
            if (manifestErr.code === 'ENOENT') {
                throw new Error('install.sh did not generate app_manifest.json');
            }
            throw new Error(`app_manifest.json contains invalid JSON: ${manifestErr.message}`);
        }
        await appRegistry.register(config.appName, manifest, protocolPath);
        installationStatus[key].step = 'registered_app';

        const capturedLogs = installationStatus[key].logs || [];
        installationStatus[key] = {
            status: 'completed',
            step: 'finished',
            logs: capturedLogs,
            timestamp: new Date().toISOString(),
            configPreserved: {
                configCsv:     !!configBackup,
                sysParameters: !!paramsBackup,
            },
        };

        await sendInstallCallback(toolId, adminUrl, config.appName, 'completed', null);

    } catch (error) {
        // Cleanup on failure — remove the directory entirely, then restore any backed-up configs
        const protocolPath = path.join(INSTALL_DIR, config.appName);
        try {
            await execAsync(`sudo rm -rf "${protocolPath}"`);
            if (configBackup || paramsBackup) {
                await fs.mkdir(protocolPath, { recursive: true });
                if (configBackup) await fs.writeFile(path.join(protocolPath, 'config.csv'), configBackup);
                if (paramsBackup) await fs.writeFile(path.join(protocolPath, 'sys_parameters.json'), paramsBackup);
            }
        } catch (cleanupError) {
            console.error('Cleanup failed:', cleanupError);
        }

        installationStatus[key] = {
            status: 'failed',
            error: error.message,
            timestamp: new Date().toISOString(),
            logs: installationStatus[key]?.logs || [],
        };

        await sendInstallCallback(toolId, adminUrl, config.appName, 'failed', error.message);
        throw error;
    }
}

async function sendInstallCallback(toolId, adminUrl, appName, status, errorMsg) {
    const cbUrl = adminUrl || process.env.IOADMIN_URL;
    if (!cbUrl || !toolId) return;
    try {
        await axios.post(`${cbUrl}/api/lsg/public/install-callback`, {
            toolId, appName, status, error: errorMsg || null,
        }, { timeout: 15000 });
        console.log(`[Install Callback] Sent ${status} for ${appName} to ${cbUrl}`);
    } catch (err) {
        console.error('[Install Callback] Failed to notify admin:', err.message);
    }
}

const installProtocol = async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Request body must be a valid JSON object' });
        }

        const { protocol, githubRepo, appName, toolId, adminUrl } = req.body;
        let key, config;

        const protocolsConfig = await loadProtocolsConfig();

        if (protocol && protocolsConfig[protocol]) {
            key = protocol;
            config = protocolsConfig[protocol];
        } else if (githubRepo && appName) {
            key = appName;
            config = { repo: githubRepo, appName, description: appName };
        } else {
            return res.status(400).json({
                error: 'Either "protocol" (known) or "githubRepo" + "appName" must be provided',
                validProtocols: Object.keys(protocolsConfig),
            });
        }

        if (installationStatus[key] && installationStatus[key].status === 'installing') {
            return res.status(409).json({
                error: 'Installation already in progress',
                status: installationStatus[key],
            });
        }

        // Already installed if present in registry
        if (appRegistry.getEntry(config.appName)) {
            return res.status(400).json({
                error: 'App is already installed. Please uninstall it first.',
            });
        }

        const token = req.body.token || process.env.GITHUB_TOKEN;
        if (!token) {
            return res.status(400).json({
                error: 'GitHub token is required. Provide in request body or set GITHUB_TOKEN env var.',
            });
        }

        performInstallation(key, config, token, toolId, adminUrl).catch(err => {
            console.error(`Installation failed for ${key}:`, err);
        });
        res.status(202).json({
            message: `Installation started for ${config.appName}`,
            status: 'installing',
            statusEndpoint: `/api/polling/protocols/${key}/status`,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── Uninstall ─────────────────────────────────────────────────────────────────

/**
 * Core uninstall logic. Runs the app's scripts/uninstall.sh, deregisters from
 * the app registry, then removes the directory.
 */
async function uninstallApp(appName, appPath) {
    const entry = uninstallStatus[appName];

    // Fix line endings
    await execAsync(
        'sed -i "s/\\r$//" scripts/*.sh 2>/dev/null || true',
        { cwd: appPath }
    );

    // Stream stdout/stderr in real-time so polling can show live logs.
    if (entry) entry.step = 'running_script';
    const appendChunk = (chunk) => {
        chunk.toString().split('\n')
            .map(l => l.trimEnd())
            .filter(Boolean)
            .forEach(l => { if (entry) entry.logs.push(l); });
    };
    const child = exec(
        `sudo bash "${path.join(appPath, 'scripts', 'uninstall.sh')}"`,
        { cwd: appPath }
    );
    child.stdout.on('data', appendChunk);
    child.stderr.on('data', appendChunk);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('uninstall.sh timed out after 5 minutes'));
        }, 300000);
        child.on('close', code => {
            clearTimeout(timer);
            code === 0 ? resolve() : reject(new Error(`uninstall.sh exited with code ${code}`));
        });
        child.on('error', err => { clearTimeout(timer); reject(err); });
    });

    // Remove app directory (may contain root-owned files created by install.sh)
    if (entry) entry.step = 'removing_directory';
    await execAsync(`sudo rm -rf "${appPath}"`);

    // Deregister only after all steps succeed
    if (entry) entry.step = 'deregistering';
    await appRegistry.deregister(appName);
}

const uninstallProtocol = async (req, res) => {
    try {
        const { protocol } = req.params;
        const config = await resolveProtocolConfig(protocol);

        if (!config) {
            return res.status(400).json({ error: 'Unknown protocol/app: ' + protocol });
        }

        if (!appRegistry.getEntry(config.appName)) {
            return res.status(404).json({
                error: 'Protocol is not installed',
                protocol,
                status: 'not_installed',
            });
        }

        uninstallStatus[config.appName] = { status: 'uninstalling', step: 'starting', logs: [] };

        uninstallApp(config.appName, config.protocolPath)
            .then(() => {
                uninstallStatus[config.appName].status = 'completed';
                setTimeout(() => { delete uninstallStatus[config.appName]; }, 60000);
            })
            .catch(err => {
                uninstallStatus[config.appName] = {
                    status: 'failed',
                    error: err.message,
                    logs: uninstallStatus[config.appName]?.logs || [],
                };
                setTimeout(() => { delete uninstallStatus[config.appName]; }, 60000);
            });

        res.status(202).json({
            message: `Uninstallation started for ${config.appName}`,
            status: 'uninstalling',
            statusEndpoint: `/api/polling/protocols/${config.appName}/uninstall-status`,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── Lifecycle: start / stop / restart ─────────────────────────────────────────

const startProtocol = async (req, res) => {
    try {
        const { protocol } = req.params;
        const config = await resolveProtocolConfig(protocol);

        if (!config) {
            return res.status(400).json({ error: 'Unknown protocol/app: ' + protocol });
        }
        if (!appRegistry.getEntry(config.appName)) {
            return res.status(404).json({ error: 'Protocol is not installed', protocol, status: 'not_installed' });
        }

        const { scriptPath, cwd, requiresSudo } = resolveScriptPath(config, 'start');
        await execAsync(`${requiresSudo ? 'sudo ' : ''}bash "${scriptPath}"`, { cwd });

        res.json({ message: `Successfully started ${config.appName}`, status: 'started' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const stopProtocol = async (req, res) => {
    try {
        const { protocol } = req.params;
        const config = await resolveProtocolConfig(protocol);

        if (!config) {
            return res.status(400).json({ error: 'Unknown protocol/app: ' + protocol });
        }
        if (!appRegistry.getEntry(config.appName)) {
            return res.status(404).json({ error: 'Protocol is not installed', protocol, status: 'not_installed' });
        }

        const { scriptPath, cwd, requiresSudo } = resolveScriptPath(config, 'stop');
        await execAsync(`${requiresSudo ? 'sudo ' : ''}bash "${scriptPath}"`, { cwd });

        res.json({ message: `Successfully stopped ${config.appName}`, status: 'stopped' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const restartProtocol = async (req, res) => {
    try {
        const { protocol } = req.params;
        const config = await resolveProtocolConfig(protocol);

        if (!config) {
            return res.status(400).json({ error: 'Unknown protocol/app: ' + protocol });
        }
        if (!appRegistry.getEntry(config.appName)) {
            return res.status(404).json({ error: 'Protocol is not installed', protocol, status: 'not_installed' });
        }

        const { scriptPath, cwd, requiresSudo } = resolveScriptPath(config, 'restart');
        await execAsync(`${requiresSudo ? 'sudo ' : ''}bash "${scriptPath}"`, { cwd });

        res.json({ message: `Successfully restarted ${config.appName}`, status: 'restarted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── Status ────────────────────────────────────────────────────────────────────

const getProtocolStatus = async (req, res) => {
    try {
        const { protocol } = req.params;

        // In-progress installation status takes priority
        if (installationStatus[protocol]) {
            const s = installationStatus[protocol];
            if (s.status === 'installing' || s.status === 'failed' || s.status === 'completed') {
                return res.json({ ...s, protocol });
            }
        }

        const config = await resolveProtocolConfig(protocol);
        if (!config) {
            return res.json({ installed: false, running: false });
        }

        const installed = !!appRegistry.getEntry(config.appName);
        if (!installed) {
            return res.json({ installed: false, running: false });
        }

        const running = await getAppRunningStatus(config.protocolPath);
        const status = { installed, running };

        if (running) {
            try {
                const { scriptPath, cwd } = resolveScriptPath(config, 'logs');
                const result = await execAsync(`bash "${scriptPath}" 10`, { cwd });
                status.logs = result.stdout;
            } catch {
                status.logs = 'Error retrieving logs';
            }
        }

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── Logs ──────────────────────────────────────────────────────────────────────

const getProtocolLogs = async (req, res) => {
    try {
        const { protocol } = req.params;
        const lines = parseInt(req.query.lines) || 50;
        const config = await resolveProtocolConfig(protocol);

        if (!config) {
            return res.status(400).json({ error: 'Unknown protocol/app: ' + protocol });
        }
        if (!appRegistry.getEntry(config.appName)) {
            return res.json({ logs: 'App is not installed' });
        }

        const { scriptPath, cwd } = resolveScriptPath(config, 'logs');
        const result = await execAsync(`bash "${scriptPath}" ${lines}`, { cwd });
        res.json({ logs: result.stdout + (result.stderr || '') });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── Config ────────────────────────────────────────────────────────────────────

const updateCsvConfig = async (req, res) => {
    try {
        const { protocol } = req.params;
        const config = await resolveProtocolConfig(protocol);

        if (!config) {
            return res.status(400).json({ error: 'Unknown protocol/app: ' + protocol });
        }

        const { rows } = req.body;
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'Rows must be a non-empty array of objects' });
        }

        const configPath = path.join(config.protocolPath, 'config.csv');
        await fs.writeFile(configPath, csv.stringify(rows, { header: true }));

        // Restart via app's own script if running
        try {
            const { scriptPath, cwd, requiresSudo } = resolveScriptPath(config, 'restart');
            await execAsync(`${requiresSudo ? 'sudo ' : ''}bash "${scriptPath}"`, { cwd });
        } catch { /* not running — ignore */ }

        res.json({
            message: `Successfully updated ${config.appName} config.csv`,
            rowsUpdated: rows.length,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateParameters = async (req, res) => {
    try {
        const { protocol } = req.params;
        const config = await resolveProtocolConfig(protocol);

        if (!config) {
            return res.status(400).json({ error: 'Unknown protocol/app: ' + protocol });
        }

        const parameters = req.body;
        if (!parameters || typeof parameters !== 'object') {
            return res.status(400).json({ error: 'Request body must be a valid JSON object' });
        }

        const parametersPath = path.join(config.protocolPath, 'sys_parameters.json');
        await fs.writeFile(parametersPath, JSON.stringify(parameters, null, 4));

        // Restart via app's own script if running
        try {
            const { scriptPath, cwd, requiresSudo } = resolveScriptPath(config, 'restart');
            await execAsync(`${requiresSudo ? 'sudo ' : ''}bash "${scriptPath}"`, { cwd });
        } catch { /* not running — ignore */ }

        res.json({ message: `Successfully updated ${config.appName} sys_parameters.json` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getConfigurations = async (req, res) => {
    try {
        const { protocol } = req.params;
        const config = await resolveProtocolConfig(protocol);

        if (!config) {
            return res.status(400).json({ error: 'Unknown protocol/app: ' + protocol });
        }

        let csvContent = [];
        let parameters = {};

        try {
            const csvFile = await fs.readFile(path.join(config.protocolPath, 'config.csv'), 'utf-8');
            csvContent = parse.parse(csvFile, { columns: true });
        } catch { /* file not present */ }

        try {
            const paramsFile = await fs.readFile(path.join(config.protocolPath, 'sys_parameters.json'), 'utf-8');
            parameters = JSON.parse(paramsFile);
        } catch { /* file not present */ }

        res.json({ csv_config: csvContent, sys_parameters: parameters });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getUninstallStatus = (req, res) => {
    const { protocol } = req.params;
    const entry = uninstallStatus[protocol] || { status: 'idle' };
    res.json(entry);
};

module.exports = {
    INSTALL_DIR,
    loadProtocolsConfig,
    uninstallApp,
    listProtocols,
    installProtocol,
    uninstallProtocol,
    getUninstallStatus,
    getProtocolStatus,
    restartProtocol,
    startProtocol,
    stopProtocol,
    updateCsvConfig,
    updateParameters,
    getConfigurations,
    getProtocolLogs,
    // Backward-compatible aliases for existing OPC UA routes
    updateOpcuaCsvConfig: async (req, res) => {
        req.params = { ...req.params, protocol: 'opcua' };
        return updateCsvConfig(req, res);
    },
    updateOpcuaParameters: async (req, res) => {
        req.params = { ...req.params, protocol: 'opcua' };
        return updateParameters(req, res);
    },
    getOpcuaConfigurations: async (req, res) => {
        req.params = { ...req.params, protocol: 'opcua' };
        return getConfigurations(req, res);
    },
};
