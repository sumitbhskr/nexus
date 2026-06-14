'use strict';

const express = require('express');
const router = express.Router();

const workflowService = require('./workflow.service');
const { authenticate, authorize } = require('../../common/middleware/auth');
const { auditLog } = require('../../common/middleware/auditLog');
const { ValidationError } = require('../../common/middleware/errorHandler');

router.use(authenticate);

// ─── GET /api/v1/workflows ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { enabled, page, limit } = req.query;
  const result = await workflowService.listWorkflows(req.tenantId, {
    enabled: enabled !== undefined ? enabled === 'true' : undefined,
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json({ success: true, data: result });
});

// ─── GET /api/v1/workflows/dlq ────────────────────────────────────────────────
router.get('/dlq', authorize('manager'), async (req, res) => {
  const entries = await workflowService.getDLQ(req.tenantId);
  res.json({ success: true, data: { entries, count: entries.length } });
});

// ─── GET /api/v1/workflows/:workflowId ───────────────────────────────────────
router.get('/:workflowId', async (req, res) => {
  const workflow = await workflowService.getWorkflow(req.params.workflowId, req.tenantId);
  res.json({ success: true, data: { workflow } });
});

// ─── GET /api/v1/workflows/:workflowId/executions ────────────────────────────
router.get('/:workflowId/executions', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 30);
  const data = await workflowService.getWorkflowExecutions(
    req.params.workflowId,
    req.tenantId,
    limit
  );
  res.json({ success: true, data });
});

// ─── POST /api/v1/workflows ───────────────────────────────────────────────────
router.post(
  '/',
  authorize('manager'),
  auditLog('WORKFLOW_CREATE', 'workflow'),
  async (req, res) => {
    if (!req.body.name) throw new ValidationError('name is required');

    const workflow = await workflowService.createWorkflow(req.tenantId, req.user.userId, req.body);
    res.status(201).json({ success: true, data: { workflow } });
  }
);

// ─── PATCH /api/v1/workflows/:workflowId ─────────────────────────────────────
router.patch(
  '/:workflowId',
  authorize('manager'),
  auditLog('WORKFLOW_UPDATE', 'workflow'),
  async (req, res) => {
    const workflow = await workflowService.updateWorkflow(
      req.params.workflowId,
      req.tenantId,
      req.body
    );
    res.json({ success: true, data: { workflow } });
  }
);

// ─── PATCH /api/v1/workflows/:workflowId/toggle ──────────────────────────────
router.patch(
  '/:workflowId/toggle',
  authorize('manager'),
  auditLog('WORKFLOW_TOGGLE', 'workflow'),
  async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      throw new ValidationError('enabled must be a boolean');
    }
    const workflow = await workflowService.toggleWorkflow(
      req.params.workflowId,
      req.tenantId,
      enabled
    );
    res.json({ success: true, data: { workflow } });
  }
);

// ─── POST /api/v1/workflows/:workflowId/trigger ───────────────────────────────
router.post(
  '/:workflowId/trigger',
  authorize('analyst'),
  auditLog('WORKFLOW_MANUAL_TRIGGER', 'workflow'),
  async (req, res) => {
    const result = await workflowService.triggerWorkflow(
      req.params.workflowId,
      req.tenantId,
      req.body.payload || {}
    );
    res.json({ success: true, data: result });
  }
);

// ─── DELETE /api/v1/workflows/:workflowId ────────────────────────────────────
router.delete(
  '/:workflowId',
  authorize('admin'),
  auditLog('WORKFLOW_DELETE', 'workflow'),
  async (req, res) => {
    await workflowService.deleteWorkflow(req.params.workflowId, req.tenantId);
    res.json({ success: true, message: 'Workflow deleted' });
  }
);

module.exports = router;
