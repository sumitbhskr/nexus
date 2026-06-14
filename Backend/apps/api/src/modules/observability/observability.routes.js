'use strict';

const express = require('express');
const router = express.Router();
const client = require('prom-client');

const { authenticate, authorize } = require('../../common/middleware/auth');
const { AuditLog } = require('../../common/middleware/auditLog');
const logger = require('../../common/utils/logger');

// ─── Initialize Prometheus metrics ───────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new client.Histogram({
  name: 'nexus_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register],
});

const agentExecutionDuration = new client.Histogram({
  name: 'nexus_agent_execution_duration_ms',
  help: 'Agent task execution duration in milliseconds',
  labelNames: ['agent_type', 'status'],
  buckets: [500, 1000, 5000, 10000, 30000, 60000, 120000],
  registers: [register],
});

const agentCostUSD = new client.Counter({
  name: 'nexus_agent_cost_usd_total',
  help: 'Total USD cost of agent LLM calls',
  labelNames: ['agent_type'],
  registers: [register],
});

const workflowExecutions = new client.Counter({
  name: 'nexus_workflow_executions_total',
  help: 'Total workflow executions',
  labelNames: ['trigger_type', 'status'],
  registers: [register],
});

const activeAgents = new client.Gauge({
  name: 'nexus_active_agents',
  help: 'Number of currently running agents',
  labelNames: ['tenant_id'],
  registers: [register],
});

const pendingApprovals = new client.Gauge({
  name: 'nexus_pending_approvals',
  help: 'Number of pending approval requests',
  labelNames: ['tenant_id', 'risk'],
  registers: [register],
});

const eventBusLag = new client.Gauge({
  name: 'nexus_event_bus_lag',
  help: 'Number of unprocessed events in the stream',
  registers: [register],
});

// ─── GET /metrics — Prometheus scrape endpoint ────────────────────────────────
// No auth — scraped by Prometheus internally
router.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// ─── Auth required for all routes below ──────────────────────────────────────
router.use(authenticate);

// ─── GET /api/v1/observability/logs ──────────────────────────────────────────
router.get('/logs', authorize('analyst'), async (req, res) => {
  const { level, limit, resourceId, action } = req.query;

  const filter = { tenantId: req.tenantId };
  if (level) filter.outcome = level;
  if (resourceId) filter.resourceId = resourceId;
  if (action) filter.action = new RegExp(action, 'i');

  const logs = await AuditLog.find(filter)
    .sort({ ts: -1 })
    .limit(Math.min(parseInt(limit) || 50, 200))
    .lean();

  res.json({ success: true, data: { logs, count: logs.length } });
});

// ─── GET /api/v1/observability/stats ─────────────────────────────────────────
router.get('/stats', authorize('analyst'), async (req, res) => {
  const mongoose = require('mongoose');
  const { Agent } = require('../agents/agent.model');
  const { Workflow } = require('../workflows/workflow.model');
  const { Approval } = require('../approvals/approval.model');

  const tenantObjId = new mongoose.Types.ObjectId(req.tenantId);

  const [agentStats, workflowStats, approvalStats] = await Promise.all([
    Agent.aggregate([
      { $match: { tenantId: tenantObjId, isActive: true } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalCostUSD: { $sum: '$totalCostUSD' },
          totalExecutions: { $sum: '$totalExecutions' },
          successRate: { $avg: { $cond: [{ $gt: ['$totalExecutions', 0] }, { $divide: ['$successfulExecutions', '$totalExecutions'] }, 1] } },
        },
      },
    ]),
    Workflow.aggregate([
      { $match: { tenantId: tenantObjId, isActive: true } },
      {
        $group: {
          _id: '$enabled',
          count: { $sum: 1 },
          totalRuns: { $sum: '$totalRuns' },
          successfulRuns: { $sum: '$successfulRuns' },
          failedRuns: { $sum: '$failedRuns' },
        },
      },
    ]),
    Approval.aggregate([
      { $match: { tenantId: tenantObjId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      agents: agentStats,
      workflows: workflowStats,
      approvals: approvalStats,
      generatedAt: new Date().toISOString(),
    },
  });
});

// ─── GET /api/v1/observability/health ─────────────────────────────────────────
router.get('/health', async (req, res) => {
  const { getMongoStatus } = require('../../config/database');
  const { getRedisStatus } = require('../../config/redis');

  const [mongoOk, redisOk] = await Promise.all([
    Promise.resolve(getMongoStatus()),
    getRedisStatus(),
  ]);

  res.json({
    success: true,
    data: {
      status: mongoOk && redisOk ? 'healthy' : 'degraded',
      services: {
        mongodb: mongoOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'disconnected',
      },
      uptime: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      pid: process.pid,
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = {
  router,
  metrics: {
    httpRequestDuration,
    agentExecutionDuration,
    agentCostUSD,
    workflowExecutions,
    activeAgents,
    pendingApprovals,
    eventBusLag,
  },
};