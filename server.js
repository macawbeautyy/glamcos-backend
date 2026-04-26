/**
 * =====================================================
 *  GLAMCOS PLATFORM - Main Server Entry Point
 *  Multi-app backend: User + Provider + Marketplace + Admin
 *  v1.1.0 — Fixed ApiResponse + booking flow
 * =====================================================
 */

// Load env vars first (must be before any other import that uses config)
const config = require('./src/config/env');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const path = require('path');
const fs = require('fs');

// Ensure required directories exist (important for fresh Render deploys)
['public/uploads', 'logs'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

const connectDB = require('./src/config/database');
const logger = require('./src/utils/logger');
const routes = require('./src/routes');
const requestLogger = require('./src/middleware/requestLogger');
const requestId = require('./src/middleware/requestId');
const { apiLimiter } = require('./src/middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');

// =====================================================
//  Initialize Express App
// =====================================================
const app = express();

// =====================================================
//  Security Middleware
// =====================================================

// Set security HTTP headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: config.env === 'production' ? undefined : false,
  })
);

// CORS - allow all platform apps
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      if (config.cors.origins.includes(origin) || config.env === 'development') {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-App-Type'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 86400, // 24 hours preflight cache
  })
);

// Sanitize data against NoSQL injection
app.use(mongoSanitize());

// Prevent HTTP parameter pollution
app.use(
  hpp({
    whitelist: [
      'price', 'rating', 'category', 'sort',
      'page', 'limit', 'status', 'role',
    ],
  })
);

// =====================================================
//  Body Parsing & Compression
// =====================================================

// Parse JSON bodies (limit 10kb to prevent abuse)
app.use(express.json({ limit: '10kb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Compress responses
app.use(compression());

// =====================================================
//  Request Pipeline Middleware
// =====================================================

// Unique request ID for tracing
app.use(requestId);

// HTTP request logging
app.use(requestLogger());

// Global rate limiter
if (config.env === 'production') {
  app.use('/api', apiLimiter);
}

// =====================================================
//  Static Files
// =====================================================
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// =====================================================
//  API Routes
// =====================================================

// Root endpoint
app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Servify Platform API',
    version: config.apiVersion,
    docs: `/api/${config.apiVersion}/health`,
    timestamp: new Date().toISOString(),
    endpoints: {
      health: `/api/${config.apiVersion}/health`,
      auth: `/api/${config.apiVersion}/auth`,
      categories: `/api/${config.apiVersion}/categories`,
      services: `/api/${config.apiVersion}/services`,
      products: `/api/${config.apiVersion}/products`,
    },
  });
});

// Mount all versioned routes
app.use(`/api/${config.apiVersion}`, routes);

// =====================================================
//  Error Handling
// =====================================================

// 404 - Route not found (must be after all routes)
app.use(notFoundHandler);

// Global error handler (must be last middleware)
app.use(errorHandler);

// =====================================================
//  Start Server
// =====================================================
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    const PORT = config.port;

    const server = app.listen(PORT, () => {
      logger.info('='.repeat(55));
      logger.info(`  SERVIFY PLATFORM API SERVER`);
      logger.info(`  Environment : ${config.env}`);
      logger.info(`  Port        : ${PORT}`);
      logger.info(`  API Base    : http://localhost:${PORT}/api/${config.apiVersion}`);
      logger.info(`  Health      : http://localhost:${PORT}/api/${config.apiVersion}/health`);
      logger.info('='.repeat(55));
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      logger.error(`Unhandled Rejection: ${err.message}`);
      logger.error(err.stack);
      // Close server & exit
      server.close(() => {
        process.exit(1);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught Exception: ${err.message}`);
      logger.error(err.stack);
      process.exit(1);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();

module.exports = app; // Export for testing

