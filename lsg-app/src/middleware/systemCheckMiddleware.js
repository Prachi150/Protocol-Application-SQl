const SystemRequirements = require('../utils/systemCheck');

let systemReady = false;
let systemStatus = null;

async function initializeSystemCheck() {
    systemStatus = await SystemRequirements.verifySystemRequirements();
    systemReady = systemStatus.success;
    
    if (!systemReady) {
        console.error('System requirements not met:');
        systemStatus.missing.forEach(req => console.error(`- ${req}`));
        if (systemStatus.needsSudo) {
            console.error('\nSome installations require sudo privileges. Please run the necessary commands manually.');
        }
    } else {
        console.log('All system requirements met successfully!');
    }
}

// Initialize on import
initializeSystemCheck();

function systemCheckMiddleware(req, res, next) {
    // Allow status check endpoint to bypass the check
    if (req.path === '/polling/system/status') {
        return next();
    }

    if (!systemReady) {
        return res.status(503).json({
            error: 'System requirements not met',
            details: systemStatus
        });
    }

    next();
}

// Add status endpoint handler
systemCheckMiddleware.getStatus = (req, res) => {
    res.json({
        ready: systemReady,
        ...systemStatus
    });
};

module.exports = systemCheckMiddleware; 