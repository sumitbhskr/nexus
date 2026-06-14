'use strict';

// ─── OpenTelemetry must be initialized BEFORE any other imports ───────────────
// require('./observability/tracer');
require('./modules/observability/tracer');

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('express-async-errors');
require('dotenv').config();

const { connectMongoDB } = require('./config/database');
const { connectRedis } = require('./config/redis');
const { initQdrant } = require('./config/qdrant');
const { initSocketIO } = require('./config/socket');
const { validateEnv } = require('./config/env.validator');
const logger = require('./common/utils/logger');
const { errorHandler } = require('./common/middleware/errorHandler');
const { requestLogger } = require('./common/middleware/requestLogger');
const { generalLimiter } = require('./common/middleware/rateLimiter');

// ─── Route imports ────────────────────────────────────────────────────────────
const authRoutes = require('./modules/auth/auth.routes');
const agentRoutes = require('./modules/agents/agent.routes');
const workflowRoutes = require('./modules/workflows/workflow.routes');
const approvalRoutes = require('./modules/approvals/approval.routes');
const integrationRoutes = require('./modules/integrations/integration.routes');
const ragRoutes = require('./modules/rag/rag.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const { router: observabilityRoutes } = require('./modules/observability/observability.routes');
const webhookRoutes = require('./modules/integrations/webhook.routes');



// ─── Validate environment on startup (fail-fast) ──────────────────────────────
validateEnv();

const app = express();
const server = http.createServer(app);

// ─── Trust proxy (required for rate limiting behind reverse proxy) ────────────
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:3000',
        'http://localhost:3001',
      ];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked for origin: ${origin}`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Tenant-ID'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
  })
);

// ─── Compression ──────────────────────────────────────────────────────────────
app.use(compression());

// ─── Body parsers ─────────────────────────────────────────────────────────────
// Webhooks need raw body for signature verification — must come before json()
app.use('/api/v1/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── HTTP request logging ─────────────────────────────────────────────────────
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === '/health' || req.url === '/metrics',
  })
);

// ─── Custom structured request logger (adds requestId, tenantId) ──────────────
app.use(requestLogger);

// ─── Global rate limiter ──────────────────────────────────────────────────────
app.use('/api', generalLimiter);

// ─── Health check (no auth, no rate limit) ────────────────────────────────────
app.get('/health', async (req, res) => {
  const { getMongoStatus } = require('./config/database');
  const { getRedisStatus } = require('./config/redis');

  const mongoOk = getMongoStatus();
  const redisOk = await getRedisStatus();

  const status = mongoOk && redisOk ? 'healthy' : 'degraded';

  res.status(status === 'healthy' ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: Math.floor(process.uptime()),
    services: {
      mongodb: mongoOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
    },
    environment: process.env.NODE_ENV,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const API_PREFIX = '/api/v1';

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/dashboard`, dashboardRoutes);
app.use(`${API_PREFIX}/agents`, agentRoutes);
app.use(`${API_PREFIX}/workflows`, workflowRoutes);
app.use(`${API_PREFIX}/approvals`, approvalRoutes);
app.use(`${API_PREFIX}/integrations`, integrationRoutes);
app.use(`${API_PREFIX}/rag`, ragRoutes);
app.use(`${API_PREFIX}/observability`, observabilityRoutes);

// Webhooks use raw body — separate router
app.use(`${API_PREFIX}/webhooks`, webhookRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// ─── Global error handler (must be last middleware) ───────────────────────────
app.use(errorHandler);

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    logger.info('Starting NEXUS API server...');

    // Connect to all external services in parallel
    await Promise.all([connectMongoDB(), connectRedis(), initQdrant()]);

    logger.info('All external services connected successfully');

    // Initialize Socket.IO (real-time events)
    initSocketIO(server);
    logger.info('Socket.IO initialized');

    // Start workflow scheduler
    const { startScheduler } = require('./modules/workflows/workflowScheduler');
    startScheduler();
    logger.info('Workflow scheduler started');

    // Start event bus consumer
    const { startEventConsumer } = require('./modules/events/eventBus');
    startEventConsumer();
    logger.info('Event bus consumer started');

    const PORT = process.env.PORT || 3001;

    server.listen(PORT, () => {
      logger.info(`NEXUS API running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        port: PORT,
        pid: process.pid,
      });
    });
  } catch (error) {
    logger.error('Failed to start NEXUS API', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal) => {
  logger.info(`${signal} received — initiating graceful shutdown`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      const mongoose = require('mongoose');
      const { getRedisClient } = require('./config/redis');

      // Close DB connections
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');

      const redisClient = getRedisClient();
      if (redisClient) {
        await redisClient.quit();
        logger.info('Redis connection closed');
      }

      // Stop scheduler
      const { stopScheduler } = require('./modules/workflows/workflowScheduler');
      stopScheduler();
      logger.info('Workflow scheduler stopped');

      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  });

  // Force shutdown after 30s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Unhandled rejection / exception guards ───────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception — shutting down', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

bootstrap();

module.exports = { app, server };
