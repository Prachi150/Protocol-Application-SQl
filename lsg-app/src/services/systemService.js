const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');

const execPromise = util.promisify(exec);

class SystemService {
    constructor() {
        this.scheduleFile = path.join(process.cwd(), 'config', 'scheduled-restarts.json');
    }

    async getSystemTime() {
        try {
            // Get current date/time
            const { stdout: dateOutput } = await execPromise('date "+%Y-%m-%dT%H:%M:%S%:z"');
            
            // Get current timezone
            const { stdout: timezoneOutput } = await execPromise('timedatectl show --property=Timezone --value');
            
            // Get NTP status
            const { stdout: ntpOutput } = await execPromise('timedatectl show --property=NTP --value');

            // Get timezone list
            const { stdout: tzListOutput } = await execPromise('timedatectl list-timezones');
            const availableTimezones = tzListOutput.trim().split('\n');

            return {
                datetime: dateOutput.trim(),
                timezone: timezoneOutput.trim(),
                ntp: {
                    enabled: ntpOutput.trim() === 'yes',
                    servers: await this.getNTPServers()
                },
                availableTimezones
            };
        } catch (error) {
            throw new Error(`Failed to get system time: ${error.message}`);
        }
    }

    async setSystemTime(config) {
        try {
            const commands = [];

            // Set timezone if provided
            if (config.timezone) {
                commands.push(`sudo timedatectl set-timezone "${config.timezone}"`);
            }

            // Set date/time if provided
            if (config.datetime) {
                commands.push(`sudo date -s "${config.datetime}"`);
            }

            // Configure NTP if provided
            if (config.ntp && typeof config.ntp.enabled === 'boolean') {
                commands.push(`sudo timedatectl set-ntp ${config.ntp.enabled}`);
                
                if (config.ntp.servers && Array.isArray(config.ntp.servers)) {
                    // Update NTP servers in configuration
                    const ntpConfig = await this.updateNTPServers(config.ntp.servers);
                    if (ntpConfig.modified) {
                        commands.push('sudo systemctl restart systemd-timesyncd');
                    }
                }
            }

            // Execute all commands
            for (const command of commands) {
                await execPromise(command);
            }

            // Return updated settings
            return await this.getSystemTime();
        } catch (error) {
            throw new Error(`Failed to set system time: ${error.message}`);
        }
    }

    async getNTPServers() {
        try {
            const config = await fs.readFile('/etc/systemd/timesyncd.conf', 'utf8');
            const serverLine = config.split('\n').find(line => line.trim().startsWith('NTP='));
            if (serverLine) {
                return serverLine.split('=')[1].trim().split(' ');
            }
            return ['pool.ntp.org']; // Default NTP server
        } catch (error) {
            return ['pool.ntp.org']; // Default if unable to read config
        }
    }

    async updateNTPServers(servers) {
        try {
            const configPath = '/etc/systemd/timesyncd.conf';
            const config = await fs.readFile(configPath, 'utf8');
            const lines = config.split('\n');
            let modified = false;

            const serverLine = `NTP=${servers.join(' ')}`;
            const serverIndex = lines.findIndex(line => line.trim().startsWith('NTP='));

            if (serverIndex >= 0) {
                if (lines[serverIndex].trim() !== serverLine) {
                    lines[serverIndex] = serverLine;
                    modified = true;
                }
            } else {
                lines.push(serverLine);
                modified = true;
            }

            if (modified) {
                await fs.writeFile(configPath, lines.join('\n'));
            }

            return { modified };
        } catch (error) {
            throw new Error(`Failed to update NTP servers: ${error.message}`);
        }
    }

    async restartSystem(options) {
        try {
            if (!options.type && !options.mode) {
                throw new Error('Restart type is required (immediate, scheduled, or recurring)');
            }

            // For backward compatibility, use type if provided, otherwise use mode
            const mode = options.type || options.mode;

            if (mode === 'immediate') {
                // Check for active users if force is not enabled
                if (!options.force) {
                    const { stdout: whoOutput } = await execPromise('who');
                    if (whoOutput.trim()) {
                        throw new Error('Active users detected. Use force: true to restart anyway');
                    }
                }

                // Schedule immediate restart
                await execPromise('sudo shutdown -r now');
                return { scheduled: false, message: 'System restart initiated' };
            } else if (mode === 'scheduled') {
                const schedule = options.schedule || options;
                if (!schedule.datetime) {
                    throw new Error('Schedule datetime is required for scheduled restart');
                }

                const scheduledTime = new Date(schedule.datetime);
                if (isNaN(scheduledTime.getTime())) {
                    throw new Error('Invalid schedule datetime');
                }

                // Check if the scheduled time is in the past
                const now = new Date();
                if (scheduledTime <= now) {
                    throw new Error('Cannot schedule restart in the past. The scheduled time must be in the future.');
                }

                // Calculate minutes until restart
                const minutesUntilRestart = Math.floor((scheduledTime - now) / (1000 * 60));
                if (minutesUntilRestart < 1) {
                    throw new Error('Scheduled time must be at least 1 minute in the future');
                }

                // Generate a unique ID for this schedule
                const scheduleId = `restart_${Date.now()}`;

                // Save the schedule details
                await this.saveSchedule({
                    id: scheduleId,
                    datetime: schedule.datetime,
                    timeStr: `+${minutesUntilRestart}`,
                    allowActiveUsers: schedule.allowActiveUsers
                });

                // Schedule the restart using relative time (+minutes)
                await execPromise(`sudo shutdown -r +${minutesUntilRestart} ${schedule.allowActiveUsers ? '--no-wall' : ''}`);
                return {
                    scheduled: true,
                    id: scheduleId,
                    datetime: schedule.datetime,
                    minutesUntilRestart,
                    message: `System restart scheduled for ${schedule.datetime} (in ${minutesUntilRestart} minutes)`
                };
            } else {
                throw new Error('Invalid restart type. Must be "immediate" or "scheduled"');
            }
        } catch (error) {
            throw new Error(`Failed to restart system: ${error.message}`);
        }
    }

    async getScheduledRestarts() {
        try {
            // Get currently scheduled shutdown
            const { stdout } = await execPromise('sudo shutdown -c --no-wall 2>&1 || true');
            
            // Load our saved schedules
            const schedules = await this.loadSchedules();
            
            // Parse the shutdown output to check if any of our schedules are still active
            const activeSchedules = schedules.filter(schedule => {
                const scheduledTime = new Date(schedule.datetime);
                return scheduledTime > new Date();
            });

            return activeSchedules;
        } catch (error) {
            throw new Error(`Failed to get scheduled restarts: ${error.message}`);
        }
    }

    async cancelScheduledRestart(id) {
        try {
            // Load schedules
            const schedules = await this.loadSchedules();
            const schedule = schedules.find(s => s.id === id);
            
            if (!schedule) {
                throw new Error('Schedule not found');
            }

            // Cancel the shutdown
            await execPromise('sudo shutdown -c --no-wall');

            // Remove from our saved schedules
            await this.saveSchedules(schedules.filter(s => s.id !== id));

            return { message: `Scheduled restart ${id} cancelled` };
        } catch (error) {
            throw new Error(`Failed to cancel scheduled restart: ${error.message}`);
        }
    }

    // Helper methods for schedule persistence
    async loadSchedules() {
        try {
            const data = await fs.readFile(this.scheduleFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async saveSchedules(schedules) {
        // Ensure data directory exists
        await fs.mkdir(path.dirname(this.scheduleFile), { recursive: true });
        await fs.writeFile(this.scheduleFile, JSON.stringify(schedules, null, 2));
    }

    async saveSchedule(schedule) {
        const schedules = await this.loadSchedules();
        schedules.push(schedule);
        await this.saveSchedules(schedules);
    }
}

module.exports = new SystemService(); 