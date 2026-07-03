/**
 * System Requirements Checker
 * Verifies and manages system dependencies for the application
 * @module utils/systemCheck
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

/**
 * SystemRequirements class
 * Provides methods to check and install system dependencies
 */
class SystemRequirements {
    /**
     * Checks if a command is available in the system PATH
     * @param {string} command - Command to check
     * @returns {Promise<boolean>} True if command exists, false otherwise
     */
    static async checkCommand(command) {
        try {
            await execAsync(`which ${command}`);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Checks if Python version meets minimum requirements (3.6+)
     * @returns {Promise<boolean>} True if Python version is sufficient
     */
    static async checkPythonVersion() {
        try {
            const { stdout } = await execAsync('python3 --version');
            const version = stdout.trim().split(' ')[1];
            const [major, minor] = version.split('.').map(Number);
            return major >= 3 && minor >= 6; // Requiring Python 3.6+
        } catch (error) {
            return false;
        }
    }

    /**
     * Checks if Node.js version meets minimum requirements (14+)
     * @returns {Promise<boolean>} True if Node.js version is sufficient
     */
    static async checkNodeVersion() {
        try {
            const { stdout } = await execAsync('node --version');
            const version = stdout.trim().slice(1); // Remove 'v' prefix
            const [major] = version.split('.').map(Number);
            return major >= 14; // Requiring Node.js 14+
        } catch (error) {
            return false;
        }
    }

    /**
     * Checks if Python venv module is available
     * @returns {Promise<boolean>} True if venv module is available
     */
    static async checkPythonVenv() {
        try {
            await execAsync('python3 -c "import venv"');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Checks if PM2 process manager is installed
     * @returns {Promise<boolean>} True if PM2 is installed
     */
    static async checkPM2() {
        return await this.checkCommand('pm2');
    }

    /**
     * Checks if Git is installed
     * @returns {Promise<boolean>} True if Git is installed
     */
    static async checkGit() {
        return await this.checkCommand('git');
    }

    /**
     * Attempts to install PM2 globally using npm
     * @returns {Promise<boolean>} True if installation successful
     */
    static async installPM2() {
        try {
            console.log('Installing PM2...');
            await execAsync('npm install -g pm2');
            return true;
        } catch (error) {
            console.error('Failed to install PM2:', error.message);
            return false;
        }
    }

    /**
     * Attempts to install Python venv module
     * Supports Debian/Ubuntu and RHEL/CentOS systems
     * @returns {Promise<boolean>} True if installation successful
     */
    static async installPythonVenv() {
        try {
            console.log('Installing python3-venv...');
            const platform = process.platform;
            
            if (platform === 'linux') {
                // For Debian/Ubuntu
                try {
                    await execAsync('sudo apt-get update && sudo apt-get install -y python3-venv');
                    return true;
                } catch (error) {
                    // For RHEL/CentOS
                    try {
                        await execAsync('sudo yum install -y python3-venv');
                        return true;
                    } catch (err) {
                        console.error('Failed to install python3-venv:', err.message);
                        return false;
                    }
                }
            } else {
                console.error('Unsupported platform for automatic python3-venv installation');
                return false;
            }
        } catch (error) {
            console.error('Failed to install python3-venv:', error.message);
            return false;
        }
    }

    /**
     * Verifies all system requirements and attempts to install missing dependencies
     * @returns {Promise<Object>} Verification results containing:
     *   - success: boolean indicating if all requirements are met
     *   - missing: array of missing requirements
     *   - needsSudo: boolean indicating if sudo access is needed
     *   - requirements: object with status of each requirement
     */
    static async verifySystemRequirements() {
        const requirements = {
            node: await this.checkNodeVersion(),
            python: await this.checkPythonVersion(),
            pythonVenv: await this.checkPythonVenv(),
            pm2: await this.checkPM2(),
            git: await this.checkGit()
        };

        const missing = [];
        let needsSudo = false;

        // Check Node.js version
        if (!requirements.node) {
            missing.push('Node.js 14+ is required');
        }

        // Check Python version
        if (!requirements.python) {
            missing.push('Python 3.6+ is required');
        }

        // Check and install python3-venv if missing
        if (!requirements.pythonVenv && requirements.python) {
            console.log('Python venv module is missing. Attempting to install...');
            const installed = await this.installPythonVenv();
            if (!installed) {
                missing.push('python3-venv is required. Please install manually: sudo apt-get install python3-venv');
                needsSudo = true;
            }
        }

        // Check and install PM2 if missing
        if (!requirements.pm2) {
            console.log('PM2 is missing. Attempting to install...');
            const installed = await this.installPM2();
            if (!installed) {
                missing.push('PM2 is required. Please install manually: npm install -g pm2');
                needsSudo = true;
            }
        }

        // Check Git
        if (!requirements.git) {
            missing.push('Git is required. Please install git');
        }

        return {
            success: missing.length === 0,
            missing,
            needsSudo,
            requirements
        };
    }
}

module.exports = SystemRequirements; 