'use strict';

const rateLimit = require('express-rate-limit');
const { getRedisClient } = require('../../config/redis');
const logger = require('../utils/logger');

// ─── Redis store for distributed rate limiting ────────────────────────────────
class RedisStore {
  constructor(prefix = 'nexus:rl:') {
    this.prefix = prefix;
    this.client = null;
  }

  getClient() {
    if (!this.client) {
      this.client = getRedisClient();
    }
    return this.client;
  }

  async increment(key) {
    const client = this.getClient();
    if (!client) return { totalHits: 1, resetTime: new Date() };

    const redisKey = `${this.prefix}${key}`;
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

    const pipeline = client.pipeline();
    pipeline.incr(redisKey);
    pipeline.pttl(redisKey);

    const results = await pipeline.exec();
    const hits = results[0][1];
    const ttl = results[1][1];

    // Set expiry on first hit
    if (hits === 1) {
      await client.pexpire(redisKey, windowMs);
    }

    const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : windowMs));

    return { totalHits: hits, resetTime };
  }

  async decrement(key) {
    const client = this.getClient();
    if (!client) return;
    await client.decr(`${this.prefix}${key}`);
  }

  async resetKey(key) {
    const client = this.getClient();
    if (!client) return;
    await client.del(`${this.prefix}${key}`);
  }
}

// ─── Key generator — per user if authenticated, else per IP ──────────────────
function keyGenerator(req) {
  return req.user?.userId ? `user:${req.user.userId}` : `ip:${req.ip}`;
}

// ─── General API rate limiter ─────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  keyGenerator,
  store: new RedisStore('nexus:rl:general:'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.url === '/health',
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.userId,
      path: req.originalUrl,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests — please try again later',
        retryAfter: res.getHeader('Retry-After'),
      },
    });
  },
});

// ─── AI / LLM endpoints limiter (stricter — cost protection) ─────────────────
const aiLimiter = rateLimit({
  windowMs: 60000,
  max: parseInt(process.env.AI_RATE_LIMIT_MAX || '20'),
  keyGenerator,
  store: new RedisStore('nexus:rl:ai:'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('AI rate limit exceeded', {
      userId: req.user?.userId,
      path: req.originalUrl,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'AI_RATE_LIMIT_EXCEEDED',
        message: 'AI request limit reached — maximum 20 requests per minute',
        retryAfter: res.getHeader('Retry-After'),
      },
    });
  },
});

// ─── Auth endpoints limiter (brute-force protection) ─────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  keyGenerator: (req) => `ip:${req.ip}`,
  store: new RedisStore('nexus:rl:auth:'),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded — possible brute force', {
      ip: req.ip,
      path: req.originalUrl,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts — try again in 15 minutes',
      },
    });
  },
});

// ─── Webhook limiter ──────────────────────────────────────────────────────────
const webhookLimiter = rateLimit({
  windowMs: 60000,
  max: 500,
  keyGenerator: (req) => `webhook:${req.ip}`,
  store: new RedisStore('nexus:rl:webhook:'),
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  generalLimiter,
  aiLimiter,
  authLimiter,
  webhookLimiter,
};
