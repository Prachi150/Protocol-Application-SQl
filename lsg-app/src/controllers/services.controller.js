const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = util.promisify(exec);

const SSH_CONFIG_SCRIPT = path.join(process.cwd(), 'services', 'ssh-config.sh');
const FTP_CONFIG_SCRIPT = path.join(process.cwd(), 'services', 'ftp-config.sh');

// ── SSH ──────────────────────────────────────────────────────────────────────

async function getSshStatus(req, res) {
    try {
        const [enabledResult, activeResult, portResult] = await Promise.allSettled([
            execAsync('systemctl is-enabled ssh 2>/dev/null || systemctl is-enabled sshd 2>/dev/null || echo disabled'),
            execAsync('systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null || echo inactive'),
            execAsync(`sudo bash "${SSH_CONFIG_SCRIPT}" get-port`),
        ]);

        const enabled = enabledResult.status === 'fulfilled'
            ? enabledResult.value.stdout.trim() === 'enabled'
            : false;
        const running = activeResult.status === 'fulfilled'
            ? activeResult.value.stdout.trim() === 'active'
            : false;
        const port = portResult.status === 'fulfilled'
            ? parseInt(portResult.value.stdout.trim(), 10) || 22
            : 22;

        res.json({ enabled, running, port });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function toggleSsh(req, res) {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    try {
        const svc = 'ssh';
        if (enabled) {
            await execAsync(`sudo systemctl enable ${svc}`);
            await execAsync(`sudo systemctl start ${svc}`);
        } else {
            await execAsync(`sudo systemctl stop ${svc}`);
            await execAsync(`sudo systemctl disable ${svc}`);
        }
        res.json({ success: true, enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function setSshConfig(req, res) {
    const { port } = req.body;
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'port must be a number between 1 and 65535' });
    }
    try {
        await execAsync(`sudo bash "${SSH_CONFIG_SCRIPT}" set-port ${portNum}`);
        await execAsync('sudo systemctl restart ssh');
        res.json({ success: true, port: portNum });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ── FTP ──────────────────────────────────────────────────────────────────────

async function getFtpStatus(req, res) {
    try {
        const [enabledResult, activeResult, configResult] = await Promise.allSettled([
            execAsync('systemctl is-enabled vsftpd 2>/dev/null || echo disabled'),
            execAsync('systemctl is-active vsftpd 2>/dev/null || echo inactive'),
            execAsync(`sudo bash "${FTP_CONFIG_SCRIPT}" get-all`),
        ]);

        const enabled = enabledResult.status === 'fulfilled'
            ? enabledResult.value.stdout.trim() === 'enabled'
            : false;
        const running = activeResult.status === 'fulfilled'
            ? activeResult.value.stdout.trim() === 'active'
            : false;

        let config = {};
        if (configResult.status === 'fulfilled') {
            for (const line of configResult.value.stdout.trim().split('\n')) {
                const [k, ...rest] = line.split('=');
                if (k) config[k.trim()] = rest.join('=').trim();
            }
        }

        res.json({
            enabled,
            running,
            port: parseInt(config.listen_port, 10) || 21,
            anonymousEnabled: config.anonymous_enable === 'YES',
            localEnabled: config.local_enable !== 'NO',
            writeEnabled: config.write_enable === 'YES',
            passvMinPort: parseInt(config.pasv_min_port, 10) || 40000,
            passvMaxPort: parseInt(config.pasv_max_port, 10) || 40100,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function toggleFtp(req, res) {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    try {
        if (enabled) {
            await execAsync('sudo systemctl enable vsftpd');
            await execAsync('sudo systemctl start vsftpd');
        } else {
            await execAsync('sudo systemctl stop vsftpd');
            await execAsync('sudo systemctl disable vsftpd');
        }
        res.json({ success: true, enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function setFtpConfig(req, res) {
    const { port, anonymousEnabled, localEnabled, writeEnabled, passvMinPort, passvMaxPort } = req.body;

    const portNum = parseInt(port, 10);
    const pMin = parseInt(passvMinPort, 10);
    const pMax = parseInt(passvMaxPort, 10);

    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'port must be 1–65535' });
    }
    if (isNaN(pMin) || isNaN(pMax) || pMin < 1024 || pMax > 65535 || pMin >= pMax) {
        return res.status(400).json({ error: 'passvMinPort/passvMaxPort must be valid 1024–65535 range' });
    }

    try {
        const settings = [
            `listen_port=${portNum}`,
            `anonymous_enable=${anonymousEnabled ? 'YES' : 'NO'}`,
            `local_enable=${localEnabled ? 'YES' : 'NO'}`,
            `write_enable=${writeEnabled ? 'YES' : 'NO'}`,
            `pasv_min_port=${pMin}`,
            `pasv_max_port=${pMax}`,
        ];

        for (const setting of settings) {
            const [k, v] = setting.split('=');
            await execAsync(`sudo bash "${FTP_CONFIG_SCRIPT}" set ${k} ${v}`);
        }

        await execAsync('sudo systemctl restart vsftpd');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = { getSshStatus, toggleSsh, setSshConfig, getFtpStatus, toggleFtp, setFtpConfig };
