const dotenv = require('dotenv');
const path = require('path');

// Load env vars BEFORE anything else
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const config = {
  // App
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiVersion: process.env.API_VERSION || 'v1',

  // MongoDB
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/servify_platform',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expire: process.env.JWT_EXPIRE || '30d',
    cookieExpire: parseInt(process.env.JWT_COOKIE_EXPIRE, 10) || 30,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpire: process.env.JWT_REFRESH_EXPIRE || '90d',
  },

  // CORS - whitelist all platform apps
  cors: {
    origins: [
      // Production — hardcoded so Render env vars being unset never breaks CORS
      'https://glamcos-user.vercel.app',
      'https://glamcos-user-gamma.vercel.app',
      'https://glamcos-provider.vercel.app',
      'https://glamcos-admin.vercel.app',
      'https://glamcos-admin-gamma.vercel.app',
      'https://www.macawbeautyy.com',
      // Partner app deployed to Vercel
      'https://provider-app-mobile.vercel.app',
      'https://provider-app-mobile-e1r24bxr9-macawbeautyy-1562s-projects.vercel.app',
      // From env vars (override or extend above)
      process.env.CORS_ORIGIN_USER_APP,
      process.env.CORS_ORIGIN_PROVIDER_APP,
      process.env.CORS_ORIGIN_MARKETPLACE_APP,
      process.env.CORS_ORIGIN_ADMIN_PANEL,
      // Local dev
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8081',
      'http://localhost:8082',
      'http://localhost:5000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:8081',
      'http://127.0.0.1:8082',
      'http://192.168.0.102:3000',
      'http://192.168.0.102:5173',
      'http://192.168.0.102:8082',
    ].filter(Boolean),
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },

  // File Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_UPLOAD, 10) || 5000000,
    uploadPath: process.env.FILE_UPLOAD_PATH || './public/uploads',
  },

  // Razorpay
  razorpay: {
    keyId:     process.env.RAZORPAY_KEY_ID     || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    file: process.env.LOG_FILE || 'logs/app.log',
  },
};

// Validate critical env vars in production
const validateConfig = () => {
  const required = ['jwt.secret', 'jwt.refreshSecret'];
  const missing = [];

  for (const key of required) {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
      value = value?.[k];
    }
    if (!value) missing.push(key);
  }

  if (missing.length > 0 && config.env === 'production') {
    throw new Error(
      `FATAL: Missing required env vars: ${missing.join(', ')}`
    );
  }
};

validateConfig();

module.exports = config;
