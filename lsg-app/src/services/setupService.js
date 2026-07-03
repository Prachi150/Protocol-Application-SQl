/**
 * setupService.js
 *
 * Manages the first-run device setup lifecycle:
 *   - isConfigured()   — reads SETUP_COMPLETE from process.env (injected by systemd EnvironmentFile)
 *   - writeSecrets()   — bcrypt-hashes password, writes all secrets to a temp file,
 *                        re-encrypts to /etc/lsg-app/secrets.env.age, shreds the temp file
 *   - restartService() — triggers a delayed systemd service restart so the response
 *                        is sent before the process exits
 *
 * Architecture note (for future re-configuration support):
 *   The POST /api/setup/complete endpoint guards itself with isConfigured().
 *   To allow an already-authenticated admin to re-run setup (secret rotation),
 *   add a jwtAuth bypass around that guard — no changes needed here.
 */

'use strict';

const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

// ── Paths ─────────────────────────────────────────────────────────────────────
const SECRETS_AGE_FILE  = '/etc/lsg-app/secrets.env.age';
const CONFIG_ENV_FILE   = '/etc/lsg-app/config.env';
const AGE_IDENTITY      = '/etc/lsg-app/age-identity';
const AGE_IDENTITY_PUB  = '/etc/lsg-app/age-identity.pub';
const SETUP_TOKEN_FILE  = '/etc/lsg-app/setup-token';
const SERVICE_NAME      = 'lsg-app';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when SETUP_COMPLETE=true is present in the process environment.
 * This flag is written by writeSecrets() and loaded at startup via systemd EnvironmentFile.
 */
function isConfigured() {
    return process.env.SETUP_COMPLETE === 'true';
}

/**
 * Update specific key=value pairs in config.env (non-sensitive settings only).
 * config.env is group-writable by the app user (chmod 664 set by install.sh).
 */
function updateConfigEnv(vars) {
    let content = fs.readFileSync(CONFIG_ENV_FILE, 'utf8');
    for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        const line = `${key}=${value}`;
        content = regex.test(content) ? content.replace(regex, line) : content + `\n${line}`;
    }
    fs.writeFileSync(CONFIG_ENV_FILE, content);
}

/**
 * Returns the one-time setup token written by install.sh, or null if absent.
 * The token file is deleted by writeSecrets() after setup completes.
 */
function getSetupToken() {
    try {
        return fs.readFileSync(SETUP_TOKEN_FILE, 'utf8').trim();
    } catch {
        return null;
    }
}

/**
 * Validate, hash, and persist all user-provided secrets.
 * Preserves machine-generated secrets (JWT_SECRET, INTERNAL_API_KEY) from process.env.
 *
 * @param {Object} fields
 * @param {string} fields.adminUsername
 * @param {string} fields.adminPassword        - plaintext, will be bcrypt-hashed
 * @param {string} fields.githubToken
 * @param {string} fields.masterMqttHost
 * @param {string} fields.masterMqttPort
 * @param {string} fields.masterMqttUsername
 * @param {string} fields.masterMqttPassword
 * @param {string} [fields.apiKeys]            - optional, comma-separated list
 */
async function writeSecrets(fields) {
    const required = ['adminUsername', 'adminPassword', 'githubToken',
                      'masterMqttHost', 'masterMqttPort', 'masterMqttUsername', 'masterMqttPassword'];
    for (const field of required) {
        if (!fields[field] || !fields[field].toString().trim()) {
            throw new Error(`Missing required field: ${field}`);
        }
    }

    // Hash admin password
    const passwordHash = await bcrypt.hash(fields.adminPassword, 12);

    // Preserve machine-generated secrets; they remain unchanged between setup runs
    const jwtSecret      = process.env.JWT_SECRET;
    const internalApiKey = process.env.INTERNAL_API_KEY;

    if (!jwtSecret || !internalApiKey) {
        throw new Error('Machine secrets (JWT_SECRET / INTERNAL_API_KEY) are missing from the environment. Reinstall the service.');
    }

    // Build the secrets file content
    const lines = [
        `JWT_SECRET=${jwtSecret}`,
        `INTERNAL_API_KEY=${internalApiKey}`,
        `SETUP_COMPLETE=true`,
        `ADMIN_USERNAME=${fields.adminUsername.trim()}`,
        `ADMIN_PASSWORD_HASH=${passwordHash}`,
        `MASTER_MQTT_USERNAME=${fields.masterMqttUsername.trim()}`,
        `MASTER_MQTT_PASSWORD=${fields.masterMqttPassword}`,
        `GITHUB_TOKEN=${fields.githubToken.trim()}`,
    ];

    if (fields.apiKeys && fields.apiKeys.trim()) {
        const parsed = fields.apiKeys.split(',').map(k => k.trim()).filter(Boolean);
        lines.push(`API_KEYS=${JSON.stringify(parsed)}`);
    }

    const content = lines.join('\n') + '\n';

    // Write to a ephemeral temp file (will be shredded immediately after encryption)
    const tmpFile = path.join(os.tmpdir(), `lsg-secrets-${Date.now()}.env`);
    fs.writeFileSync(tmpFile, content, { mode: 0o600 });

    const tmpOut = SECRETS_AGE_FILE + '.tmp';
    try {
        // Verify the age tools and identity exist
        if (!fs.existsSync(AGE_IDENTITY_PUB)) {
            throw new Error(`age public key not found at ${AGE_IDENTITY_PUB}. Reinstall the service.`);
        }

        // Encrypt to a temp file first, then rename — rename is atomic on Linux
        execFileSync('/usr/bin/age', [
            '-R', AGE_IDENTITY_PUB,
            '-o', tmpOut,
            tmpFile,
        ]);
        fs.renameSync(tmpOut, SECRETS_AGE_FILE);

        // Token is single-use — delete it now that secrets are committed
        try { fs.unlinkSync(SETUP_TOKEN_FILE); } catch { /* not present in interactive mode */ }

        // Write non-sensitive MQTT config into the plaintext config.env
        updateConfigEnv({
            MASTER_MQTT_HOST: fields.masterMqttHost.trim(),
            MASTER_MQTT_PORT: fields.masterMqttPort.trim(),
        });

    } finally {
        // Always shred the plaintext temp file, even on error
        try {
            execFileSync('shred', ['-u', tmpFile]);
        } catch {
            // shred unavailable — best-effort delete
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
        // Clean up encrypted temp if rename didn't happen (error path)
        try { fs.unlinkSync(tmpOut); } catch { /* already renamed — expected on success */ }
    }
}

/**
 * Trigger a delayed service restart via sudo systemctl.
 * The delay ensures the HTTP response is fully sent before the process exits.
 * Sudoers entry is written by install.sh:
 *   <APP_USER> ALL=(root) NOPASSWD: /usr/bin/systemctl restart lsg-app
 */
function restartService() {
    setTimeout(() => {
        execFile('sudo', ['/usr/bin/systemctl', 'restart', SERVICE_NAME], (err) => {
            if (err) {
                console.error('[Setup] Service restart failed:', err.message);
            }
        });
    }, 1500);
}

module.exports = { isConfigured, getSetupToken, writeSecrets, updateConfigEnv, restartService };
