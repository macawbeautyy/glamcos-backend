const morgan = require('morgan');
const logger = require('../utils/logger');

/**
 * HTTP request logging middleware.
 * - Development: colorized concise output to console
 * - Production: combined format piped to Winston file logger
 */
const requestLogger = () => {
  const env = process.env.NODE_ENV || 'development';

  if (env === 'development') {
    // Custom dev format: method url status responseTime
    return morgan('dev');
  }

  // Production: full Apache-style logs via Winston
  return morgan('combined', { stream: logger.stream });
};

module.exports = requestLogger;
