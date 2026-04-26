/**
 * Wraps async route handlers to catch errors automatically.
 * Eliminates the need for try-catch in every controller method.
 *
 * Usage: router.get('/route', asyncHandler(myController));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
