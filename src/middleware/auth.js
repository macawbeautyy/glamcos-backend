const jwt = require('jsonwebtoken');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// Import User model lazily to avoid circular dependency
let User;
const getUser = () => {
  if (!User) User = require('../models/User');
  return User;
};

/**
 * Protect routes - verify JWT token
 */
const protect = asyncHandler(async (req, _res, next) => {
  let token;

  // Check Authorization header
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  // Fallback to cookie
  else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    throw ApiError.unauthorized('Access denied. No token provided.');
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // Get user from DB (exclude password)
    const UserModel = getUser();
    const user = await UserModel.findById(decoded.id).select('-password -refreshToken');

    if (!user) {
      throw ApiError.unauthorized('User associated with this token no longer exists.');
    }

    // Check if user is active
    if (user.status === 'suspended' || user.status === 'banned') {
      throw ApiError.forbidden('Your account has been suspended. Contact support.');
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      throw error; // Let error handler format it
    }
    throw error;
  }
});

/**
 * Authorize by role(s)
 * Usage: authorize('admin', 'provider')
 */
const authorize = (...roles) => {
  return (req, _res, next) => {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required.');
    }

    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden(
        `Role '${req.user.role}' is not authorized to access this resource.`
      );
    }

    next();
  };
};

/**
 * Optional auth - attaches user if token present, continues if not
 */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      const UserModel = getUser();
      req.user = await UserModel.findById(decoded.id).select('-password -refreshToken');
    } catch {
      // Token invalid - continue without user
    }
  }

  next();
});

module.exports = { protect, authorize, optionalAuth };
