'use strict';

const express = require('express');
const router = express.Router();

const agentService = require('./agent.service');
const { authenticate, authorize } = require('../../common/middleware/auth');
const { auditLog } = require('../../common/middleware/auditLog');
const { aiLimiter } = require('../../common/middleware/rateLimiter');
const { ValidationError } = require('../../common/middleware/errorHandler');

// All agent routes require authentication
router.use(authenticate);

// ─── GET /api/v1/agents ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const agents = await agentService.listAgents(req.tenantId);
  res.json({ success: true, data: { agents, count: agents.length } });
});

// ─── GET /api/v1/agents/:agentId ──────────────────────────────────────────────
router.get('/:agentId', async (req, res) => {
  const agent = await agentService.getAgent(req.params.agentId, req.tenantId);
  res.json({ success: true, data: { agent } });
});

// ─── GET /api/v1/agents/:agentId/executions ───────────────────────────────────
router.get('/:agentId/executions', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const data = await agentService.getAgentExecutions(req.params.agentId, req.tenantId, limit);
  res.json({ success: true, data });
});

// ─── GET /api/v1/agents/:agentId/memory ──────────────────────────────────────
router.get('/:agentId/memory', authorize('manager'), async (req, res) => {
  const data = await agentService.getAgentMemory(req.params.agentId, req.tenantId);
  res.json({ success: true, data });
});

// ─── POST /api/v1/agents/:agentId/run ────────────────────────────────────────
router.post(
  '/:agentId/run',
  authorize('analyst'),
  aiLimiter,
  auditLog('AGENT_TASK_EXECUTE', 'agent'),
  async (req, res) => {
    const { task } = req.body;

    if (!task) {
      throw new ValidationError('task is required');
    }

    const result = await agentService.executeTask({
      agentId: req.params.agentId,
      task,
      tenantId: req.tenantId,
    });

    res.status(202).json({ success: true, data: result });
  }
);

// ─── PATCH /api/v1/agents/:agentId ───────────────────────────────────────────
router.patch(
  '/:agentId',
  authorize('manager'),
  auditLog('AGENT_CONFIG_UPDATE', 'agent'),
  async (req, res) => {
    const agent = await agentService.updateAgentConfig(req.params.agentId, req.tenantId, req.body);
    res.json({ success: true, data: { agent } });
  }
);

// ─── PATCH /api/v1/agents/:agentId/status ────────────────────────────────────
router.patch(
  '/:agentId/status',
  authorize('manager'),
  auditLog('AGENT_STATUS_CHANGE', 'agent'),
  async (req, res) => {
    const { status } = req.body;
    const agent = await agentService.setAgentStatus(req.params.agentId, req.tenantId, status);
    res.json({ success: true, data: { agent } });
  }
);

// ─── DELETE /api/v1/agents/:agentId/memory ───────────────────────────────────
router.delete(
  '/:agentId/memory',
  authorize('admin'),
  auditLog('AGENT_MEMORY_CLEAR', 'agent'),
  async (req, res) => {
    await agentService.clearAgentMemory(req.params.agentId, req.tenantId);
    res.json({ success: true, message: 'Agent memory cleared' });
  }
);

module.exports = router;
