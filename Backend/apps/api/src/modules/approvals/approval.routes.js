'use strict';

const express = require('express');
const router = express.Router();

const approvalService = require('./approval.service');
const { authenticate, authorize } = require('../../common/middleware/auth');
const { auditLog } = require('../../common/middleware/auditLog');
const { ValidationError } = require('../../common/middleware/errorHandler');

router.use(authenticate);

// ─── GET /api/v1/approvals ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, risk, page, limit } = req.query;
  const result = await approvalService.listApprovals(req.tenantId, {
    status,
    risk,
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json({ success: true, data: result });
});

// ─── GET /api/v1/approvals/stats ──────────────────────────────────────────────
router.get('/stats', authorize('manager'), async (req, res) => {
  const stats = await approvalService.getApprovalStats(req.tenantId);
  res.json({ success: true, data: { stats } });
});

// ─── GET /api/v1/approvals/:approvalId ───────────────────────────────────────
router.get('/:approvalId', async (req, res) => {
  const approval = await approvalService.getApproval(
    req.params.approvalId,
    req.tenantId
  );
  res.json({ success: true, data: { approval } });
});

// ─── PATCH /api/v1/approvals/:approvalId ─────────────────────────────────────
// Approve or reject — managers and above only
router.patch(
  '/:approvalId',
  authorize('manager'),
  auditLog('APPROVAL_REVIEW', 'approval'),
  async (req, res) => {
    const { action, reviewNote } = req.body;

    if (!action || !['approved', 'rejected'].includes(action)) {
      throw new ValidationError("action must be 'approved' or 'rejected'");
    }

    const approval = await approvalService.reviewApproval({
      approvalId: req.params.approvalId,
      tenantId: req.tenantId,
      reviewerId: req.user.userId,
      reviewerEmail: req.user.email,
      action,
      reviewNote,
    });

    res.json({ success: true, data: { approval } });
  }
);

// ─── DELETE /api/v1/approvals/:approvalId ─────────────────────────────────────
router.delete(
  '/:approvalId',
  authorize('manager'),
  auditLog('APPROVAL_CANCEL', 'approval'),
  async (req, res) => {
    const approval = await approvalService.cancelApproval(
      req.params.approvalId,
      req.tenantId,
      req.user.userId
    );
    res.json({ success: true, data: { approval } });
  }
);

module.exports = router;