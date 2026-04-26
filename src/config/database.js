const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  const config = require('./env');

  const options = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4, // Use IPv4
  };

  try {
    const conn = await mongoose.connect(config.mongoUri, options);

    logger.info(
      `MongoDB Connected: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`
    );

    // Connection event listeners
    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting reconnection...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected successfully');
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received. Closing MongoDB connection...`);
      await mongoose.connection.close();
      logger.info('MongoDB connection closed gracefully');
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    return conn;
  } catch (error) {
    logger.error(`MongoDB connection failed: ${error.message}`);
    // Retry logic for production
    if (config.env === 'production') {
      logger.info('Retrying MongoDB connection in 5 seconds...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return connectDB();
    }
    process.exit(1);
  }
};

module.exports = connectDB;
