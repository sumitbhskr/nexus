'use strict';

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const { authenticate } = require('../../common/middleware/auth');
const { getRedisClient, KEYS } = require('../../config/redis');
const logger = require('../../common/utils/logger');

router.use(authenticate);

const CACHE_TTL = 30; // seconds

// ─── GET /api/v1/dashboard/metrics ───────────────────────────────────────────
router.get('/metrics', async (req, res) => {
  const redis = getRedisClient();
  const cacheKey = KEYS.dashboardCache(req.tenantId);

  // Try cache first
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json({
          success: true,
          data: JSON.parse(cached),
          cached: true,
        });
      }
    } catch {
      // Cache miss — continue to DB
    }
  }

  const tenantObjId = new mongoose.Types.ObjectId(req.tenantId);

  const { Agent } = require('../agents/agent.model');
  const { Workflow } = require('../workflows/workflow.model');
  const { Approval } = require('../approvals/approval.model');

  const [agentSummary, workflowSummary, approvalSummary] = await Promise.all([
    Agent.aggregate([
      { $match: { tenantId: tenantObjId, isActive: true } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalCostUSD: { $sum: '$totalCostUSD' },
          totalExecutions: { $sum: '$totalExecutions' },
        },
      },
    ]),
    Workflow.aggregate([
      { $match: { tenantId: tenantObjId, isActive: true } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          enabled: { $sum: { $cond: ['$enabled', 1, 0] } },
          totalRuns: { $sum: '$totalRuns' },
          failedRuns: { $sum: '$failedRuns' },
        },
      },
    ]),
    Approval.aggregate([
      { $match: { tenantId: tenantObjId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const agentsByStatus = {};
  agentSummary.forEach((a) => { agentsByStatus[a._id] = a; });

  const approvalsByStatus = {};
  approvalSummary.forEach((a) => { approvalsByStatus[a._id] = a.count; });

  const wf = workflowSummary[0] || {};
  const totalAgentCost = agentSummary.reduce((sum, a) => sum + (a.totalCostUSD || 0), 0);

  const metrics = {
    // Business metrics (mock for demo — replace with real data sources)
    mrr: 2840000,
    mrrDelta: 8.3,
    mrrDeltaType: 'increase',

    // Customer health
    churnRiskCount: 14,
    churnRiskDelta: 3,
    healthyAccountCount: 210,
    totalAccounts: 1240,

    // Incidents
    openIncidents: 7,
    criticalIncidents: 2,
    slaCompliance: 94.2,

    // Agents
    runningAgents: agentsByStatus['running']?.count || 0,
    idleAgents: agentsByStatus['idle']?.count || 0,
    errorAgents: agentsByStatus['error']?.count || 0,
    totalAgentCostUSD: Math.round(totalAgentCost * 100) / 100,
    totalAgentExecutions: agentSummary.reduce((s, a) => s + (a.totalExecutions || 0), 0),

    // Workflows
    totalWorkflows: wf.total || 0,
    enabledWorkflows: wf.enabled || 0,
    workflowRunsToday: wf.totalRuns || 0,
    workflowFailuresToday: wf.failedRuns || 0,

    // Approvals
    pendingApprovals: approvalsByStatus['pending'] || 0,
    approvedToday: approvalsByStatus['approved'] || 0,
    rejectedToday: approvalsByStatus['rejected'] || 0,

    generatedAt: new Date().toISOString(),
  };

  // Cache result
  if (redis) {
    try {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(metrics));
    } catch {
      // Non-fatal
    }
  }

  res.json({ success: true, data: metrics, cached: false });
});

// ─── GET /api/v1/dashboard/incidents ─────────────────────────────────────────
router.get('/incidents', async (req, res) => {
  const { limit = 10, severity } = req.query;

  // Return mock incidents for demo
  // In production: query your incidents collection
  const incidents = [
    { id: 'INC-001', title: 'API Gateway latency spike >2s', severity: 'critical', source: 'Datadog', status: 'open', createdAt: new Date(Date.now() - 4 * 60000) },
    { id: 'INC-002', title: 'Acme Corp CSM escalation requested', severity: 'high', source: 'Salesforce', status: 'open', createdAt: new Date(Date.now() - 11 * 60000) },
    { id: 'INC-003', title: 'Payment processor timeout (3 failed)', severity: 'critical', source: 'Stripe', status: 'open', createdAt: new Date(Date.now() - 18 * 60000) },
    { id: 'INC-004', title: 'SLA breach risk: TechFlow ticket #3821', severity: 'medium', source: 'Zendesk', status: 'investigating', createdAt: new Date(Date.now() - 32 * 60000) },
    { id: 'INC-005', title: 'CPU utilization >85% on prod-db-02', severity: 'high', source: 'AWS', status: 'open', createdAt: new Date(Date.now() - 45 * 60000) },
  ]
    .filter((i) => !severity || i.severity === severity)
    .slice(0, parseInt(limit));

  res.json({ success: true, data: { incidents, count: incidents.length } });
});

// ─── GET /api/v1/dashboard/activity ──────────────────────────────────────────
router.get('/activity', async (req, res) => {
  const { AuditLog } = require('../../common/middleware/auditLog');
  const { limit = 20 } = req.query;

  const activity = await AuditLog.find({ tenantId: req.tenantId })
    .sort({ ts: -1 })
    .limit(Math.min(parseInt(limit), 50))
    .lean();

  res.json({ success: true, data: { activity, count: activity.length } });
});

module.exports = router;