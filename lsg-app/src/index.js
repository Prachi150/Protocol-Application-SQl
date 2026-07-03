const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const configManager = require('./services/configManager');
const appRegistry = require('./services/appRegistry');
const heartbeatService = require('./services/heartbeatService');
const { initMasterMqttClient } = require('./services/masterMqttClient');
const routes = require('./routes');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: config.corsOrigin
}));
app.use(morgan('dev'));
app.use(express.json({ limit: config.iot.maxPayloadSize }));
app.use(express.urlencoded({ extended: true }));

// Initialize configuration and services before starting the server
async function startServer() {
  try {
    // Initialize configuration
    await configManager.init();
    console.log('Configuration initialized successfully');

    // Initialize app registry
    await appRegistry.init();
    console.log('App registry initialized successfully');

    // Routes
    app.use('/api', routes);

    // Serve React frontend static files in production
    const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
    app.use(express.static(clientBuildPath));

    // Error handling middleware
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });

    // Catch-all: serve React index.html for client-side routing
    app.get('*', (req, res) => {
      const indexPath = path.join(clientBuildPath, 'index.html');
      const fs = require('fs');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).json({ message: 'Not found' });
      }
    });

    // Start Master MQTT Client (ioadmin communication: commands, heartbeat, onboarding)
    initMasterMqttClient().catch(err => {
      console.error('Master MQTT Client failed to start:', err.message);
    });

    // Start heartbeat sender (reports stats to ioadmin periodically)
    heartbeatService.start().catch(err => {
      console.error('Heartbeat service failed to start:', err.message);
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer(); 