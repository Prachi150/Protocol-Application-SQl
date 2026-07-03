const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const routes = require('./routes');
// const iotRoutes = require('./routes/iot.routes');
// const configRoutes = require('./routes/config.routes');

const createApp = () => {
  const app = express();

  // Middleware
  app.use(cors({
    origin: config.corsOrigin
  }));
  app.use(morgan('dev'));
  app.use(express.json({ limit: config.iot.maxPayloadSize }));
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use(config.apiPrefix, routes);
  // app.use(`${config.apiPrefix}/iot`, iotRoutes);
  // app.use(`${config.apiPrefix}/config`, configRoutes);

  // Health check endpoint
  app.get(`${config.apiPrefix}/health`, (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message
    });
  });

  return app;
};

module.exports = createApp; 