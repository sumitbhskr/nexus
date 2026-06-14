'use strict';

const Redis = require('ioredis');
const logger = require('../common/utils/logger');

let redisClient = null;
let pubClient = null;
let subClient = null;

const REDIS_OPTIONS = {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 10) {
      logger.error('Redis: max retries exceeded');
      return null;
    }
    const delay = Math.min(times * 200, 3000);
    logger.warn(`Redis: reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  enableReadyCheck: true,
  lazyConnect: false,
};

async function connectRedis() {
  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error('REDIS_URL is not defined');
  }

  redisClient = new Redis(url, REDIS_OPTIONS);
  pubClient = new Redis(url, REDIS_OPTIONS);
  subClient = new Redis(url, REDIS_OPTIONS);

  redisClient.on('connect', () => logger.info('Redis client connected'));
  redisClient.on('error', (err) => logger.error('Redis client error', { error: err.message }));
  redisClient.on('close', () => logger.warn('Redis client connection closed'));

  // Verify connection
  await redisClient.ping();
  logger.info('Redis ping successful');
}

function getRedisClient() {
  return redisClient;
}

function getPubClient() {
  return pubClient;
}

function getSubClient() {
  return subClient;
}

async function getRedisStatus() {
  try {
    if (!redisClient) return false;
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

// ─── Redis key helpers ────────────────────────────────────────────────────────
const KEYS = {
  refreshToken: (userId) => `nexus:refresh:${userId}`,
  rateLimit: (identifier) => `nexus:rl:${identifier}`,
  agentState: (agentId) => `nexus:agent:${agentId}:state`,
  workflowLock: (workflowId) => `nexus:wf:lock:${workflowId}`,
  approvalCache: (approvalId) => `nexus:approval:${approvalId}`,
  dashboardCache: (tenantId) => `nexus:dashboard:${tenantId}`,
  eventStream: (tenantId) => `nexus:events:${tenantId}`,
  sessionBlacklist: (jti) => `nexus:blacklist:${jti}`,
};

module.exports = {
  connectRedis,
  getRedisClient,
  getPubClient,
  getSubClient,
  getRedisStatus,
  KEYS,
};
