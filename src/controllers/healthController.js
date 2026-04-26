const mongoose = require('mongoose');
const ApiResponse = require('../utils/ApiResponse');

/**
 * @desc    Health check - server status
 * @route   GET /api/v1/health
 * @access  Public
 */
const healthCheck = (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return ApiResponse.success(res, {
    message: 'Servify Platform API is running',
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(process.uptime())}s`,
      environment: process.env.NODE_ENV,
      database: dbStates[dbState] || 'unknown',
      memory: {
        used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      },
      version: require('../../package.json').version,
    },
  });
};

module.exports = { healthCheck };
