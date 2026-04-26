const { v4: uuidv4 } = require('uuid');

/**
 * Attach a unique request ID to every incoming request.
 * Used for log correlation and debugging across services.
 */
const requestId = (req, res, next) => {
  const id = req.headers['x-request-id'] || uuidv4();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

module.exports = requestId;
