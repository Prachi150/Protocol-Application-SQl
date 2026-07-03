const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

const ACTIONS = {
    'restart-system': {
        label: 'Restart system',
        fn: () => execPromise('sudo shutdown -r now'),
    },
    'restart-lsg-app': {
        label: 'Restart LSG app',
        fn: () => execPromise('sudo systemctl restart lsg-app'),
    },
    'restart-redpanda': {
        label: 'Restart Redpanda broker',
        fn: () => execPromise('sudo systemctl restart redpanda'),
    },
    'restart-pipelines': {
        label: 'Restart all pipelines',
        fn: async () => {
            const { stdout } = await execPromise(
                "systemctl list-units --type=service --all --no-legend --plain 2>/dev/null | awk '{print $1}' | grep '^redpanda-connect@' || true"
            );
            for (const svc of stdout.trim().split('\n').filter(Boolean)) {
                await execPromise(`sudo systemctl restart "${svc}"`).catch(() => {});
            }
        },
    },
};

class ScheduleService {
    constructor() {
        this.schedulesPath = path.join(process.cwd(), 'config', 'recurring-schedules.json');
        this.activeJobs = new Map();
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        
        try {
            // Ensure config directory exists
            const dataDir = path.dirname(this.schedulesPath);
            await fs.mkdir(dataDir, { recursive: true });

            // Load existing schedules
            await this.loadSchedules();
            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize ScheduleService:', error);
            throw error;
        }
    }

    async loadSchedules() {
        try {
            const schedules = await this.getSchedules();
            // Clear existing jobs
            this.clearAllJobs();
            
            // Recreate jobs from saved schedules
            for (const schedule of schedules) {
                this.createJob(schedule);
            }
        } catch (error) {
            console.error('Failed to load schedules:', error);
            throw error;
        }
    }

    async getSchedules() {
        try {
            console.log('Loading schedules from:', this.schedulesPath);
            const data = await fs.readFile(this.schedulesPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, return empty array
                return [];
            }
            throw error;
        }
    }

    async saveSchedules(schedules) {
        await fs.writeFile(this.schedulesPath, JSON.stringify(schedules, null, 2));
    }

    createJob(schedule) {
        if (!schedule.id || !schedule.pattern) return;

        const actionEntry = ACTIONS[schedule.action] || ACTIONS['restart-system'];
        const job = cron.schedule(schedule.pattern, async () => {
            try {
                await actionEntry.fn();
            } catch (error) {
                console.error(`Failed to execute action "${schedule.action}" for schedule ${schedule.id}:`, error);
            }
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        // Store the job
        this.activeJobs.set(schedule.id, job);
    }

    clearJob(scheduleId) {
        const job = this.activeJobs.get(scheduleId);
        if (job) {
            job.stop();
            this.activeJobs.delete(scheduleId);
        }
    }

    clearAllJobs() {
        for (const [id, job] of this.activeJobs) {
            job.stop();
        }
        this.activeJobs.clear();
    }

    generateCronPattern(type, value) {
        switch (type) {
            case 'hourly':
                const hours = parseInt(value);
                if (isNaN(hours) || hours < 1 || hours > 23) {
                    throw new Error('Hourly interval must be between 1 and 23');
                }
                return `0 */${hours} * * *`;
            
            case 'daily':
                const [hour, minute] = value.split(':').map(Number);
                if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
                    throw new Error('Invalid time format. Use HH:mm in 24-hour format');
                }
                return `${minute} ${hour} * * *`;
            
            case 'weekly':
                const [day, time] = value.split('@');
                const [weekHour, weekMinute] = time.split(':').map(Number);
                if (isNaN(weekHour) || weekHour < 0 || weekHour > 23 || 
                    isNaN(weekMinute) || weekMinute < 0 || weekMinute > 59) {
                    throw new Error('Invalid time format. Use day@HH:mm in 24-hour format');
                }
                return `${weekMinute} ${weekHour} * * ${day}`;
            
            default:
                throw new Error('Invalid schedule type');
        }
    }

    getActionCatalog() {
        return Object.entries(ACTIONS).map(([key, { label }]) => ({ key, label }));
    }

    async addSchedule(type, value, action = 'restart-system') {
        await this.init();

        try {
            const existingSchedules = await this.getSchedules();
            const isDuplicate = existingSchedules.some(schedule =>
                schedule.type === type && schedule.value === value && schedule.action === action
            );

            if (isDuplicate) {
                throw new Error(`A ${type} schedule with value "${value}" and action "${action}" already exists`);
            }

            const pattern = this.generateCronPattern(type, value);

            const newSchedule = {
                id: `schedule_${Date.now()}`,
                type,
                value,
                action: ACTIONS[action] ? action : 'restart-system',
                pattern,
                created: new Date().toISOString()
            };

            existingSchedules.push(newSchedule);
            await this.saveSchedules(existingSchedules);
            
            // Create and start the job
            this.createJob(newSchedule);

            return newSchedule;
        } catch (error) {
            throw new Error(`Failed to add schedule: ${error.message}`);
        }
    }

    async removeSchedule(scheduleId) {
        await this.init();

        try {
            const schedules = await this.getSchedules();
            const updatedSchedules = schedules.filter(s => s.id !== scheduleId);
            
            if (schedules.length === updatedSchedules.length) {
                throw new Error('Schedule not found');
            }

            await this.saveSchedules(updatedSchedules);
            this.clearJob(scheduleId);

            return { message: `Schedule ${scheduleId} removed` };
        } catch (error) {
            throw new Error(`Failed to remove schedule: ${error.message}`);
        }
    }

    async listSchedules() {
        await this.init();
        return await this.getSchedules();
    }

    async getActiveSchedules() {
        await this.init();
        const allSchedules = await this.getSchedules();
        
        // Filter to only return schedules that have active cron jobs
        return allSchedules.filter(schedule => {
            return this.activeJobs.has(schedule.id);
        });
    }
}

module.exports = new ScheduleService(); 