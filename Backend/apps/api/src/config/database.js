'use strict';

const mongoose = require('mongoose');
const logger = require('../common/utils/logger');

let isConnected = false;

const MONGOOSE_OPTIONS = {
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
  retryWrites: true,
  retryReads: true,
};

async function connectMongoDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not defined');
  }

  mongoose.connection.on('connected', () => {
    isConnected = true;
    logger.info('MongoDB connected', {
      host: mongoose.connection.host,
      name: mongoose.connection.name,
    });
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB disconnected — attempting reconnect');
  });

  mongoose.connection.on('error', (err) => {
    isConnected = false;
    logger.error('MongoDB connection error', { error: err.message });
  });

  await mongoose.connect(uri, MONGOOSE_OPTIONS);
  isConnected = true;
}

function getMongoStatus() {
  return isConnected && mongoose.connection.readyState === 1;
}

// MongoDB init script for Docker
const MONGO_INIT_SCRIPT = `
db = db.getSiblingDB('nexus');
db.createUser({
  user: 'nexus',
  pwd: 'nexus_dev_password',
  roles: [{ role: 'readWrite', db: 'nexus' }]
});
db.createCollection('users');
db.createCollection('tenants');
`;

module.exports = { connectMongoDB, getMongoStatus };
