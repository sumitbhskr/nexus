'use strict';

const { Approval } = require('./approval.model');
const { emitApprovalRequest, emitToTenant } = require('../../config/socket');
const {
  NotFoundError,
  AuthorizationError,
  AppError,
} = require('../../common/middleware/errorHandler');
const logger = require('../../common/utils/logger');

// ─── Create approval request ──────────────────────────────────────────────────
async function createApproval({
  tenantId,
  action,
  detail,
  risk,
  agentId = null,
  agentType = null,
  userId = null,
  workflowId = null,
  executionId = null,
  payload = {},
}) {
  const approval = await Approval.create({
    tenantId,
    action,
    detail,
    risk,
    requestedBy: {
      agentId,
      agentType,
      userId,
      source: agentId ? 'agent' : workflowId ? 'workflow' : 'user',
    },
    workflowId,
    executionId,
    payload,
    auditTrail: [
      {
        action: 'APPROVAL_REQUESTED',
        actor: agentType || 'system',
        actorId: agentId,
        metadata: { risk, action },
      },
    ],
  });

  // Real-time notification to all managers/admins
  emitApprovalRequest(tenantId, {
    approvalId: approval._id,
    action,
    risk,
    detail: detail.slice(0, 100),
  });

  // Notify via Slack if configured
  notifySlackForApproval(tenantId, approval).catch((err) => {
    logger.warn('Slack approval notification failed', { error: err.message });
  });

  logger.info('Approval request created', {
    approvalId: approval._id,
    tenantId,
    action,
    risk,
  });

  return approval;
}

// ─── Slack notification for high-risk approvals ───────────────────────────────
async function notifySlackForApproval(tenantId, approval) {
  if (approval.risk !== 'high') return;

  try {
    const { SlackConnector } = require('../integrations/slack/slack.connector');
    const connector = new SlackConnector(tenantId);
    await connector.postMessage({
      channel: '#approvals',
      text: `🔴 *High-Risk Approval Required*\n*Action:* ${approval.action}\n*Risk:* ${approval.risk.toUpperCase()}\n*Detail:* ${approval.detail.slice(0, 200)}\n\nReview at: ${process.env.FRONTEND_URL}/approvals`,
    });
  } catch {
    // Silent fail — Slack integration may not be configured
  }
}

// ─── List approvals ───────────────────────────────────────────────────────────
async function listApprovals(tenantId, { status, risk, page = 1, limit = 20 } = {}) {
  const filter = { tenantId };
  if (status) filter.status = status;
  if (risk) filter.risk = risk;

  const skip = (page - 1) * limit;

  const [approvals, total] = await Promise.all([
    Approval.find(filter)
      .populate('reviewedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Approval.countDocuments(filter),
  ]);

  return {
    approvals,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
}

// ─── Get approval by ID ───────────────────────────────────────────────────────
async function getApproval(approvalId, tenantId) {
  const approval = await Approval.findOne({ _id: approvalId, tenantId }).populate(
    'reviewedBy',
    'firstName lastName email'
  );

  if (!approval) throw new NotFoundError('Approval');
  return approval;
}

// ─── Approve or reject ────────────────────────────────────────────────────────
async function reviewApproval({
  approvalId,
  tenantId,
  reviewerId,
  reviewerEmail,
  action,
  reviewNote,
}) {
  if (!['approved', 'rejected'].includes(action)) {
    throw new AppError("Action must be 'approved' or 'rejected'", 400, 'INVALID_ACTION');
  }

  const approval = await Approval.findOne({
    _id: approvalId,
    tenantId,
    status: 'pending',
  });

  if (!approval) {
    throw new NotFoundError('Pending approval');
  }

  if (approval.expiresAt < new Date()) {
    approval.status = 'expired';
    await approval.save();
    throw new AppError('Approval request has expired', 410, 'APPROVAL_EXPIRED');
  }

  // Update approval
  approval.status = action;
  approval.reviewedBy = reviewerId;
  approval.reviewedAt = new Date();
  approval.reviewNote = reviewNote || null;

  approval.auditTrail.push({
    action: action === 'approved' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
    actor: reviewerEmail,
    actorId: reviewerId,
    metadata: { reviewNote },
  });

  await approval.save();

  // Real-time notification
  emitToTenant(tenantId, 'approval:reviewed', {
    approvalId,
    action,
    reviewedBy: reviewerEmail,
  });

  // If workflow was waiting — resume or cancel
  if (approval.workflowId && approval.executionId) {
    const { resumeWorkflowAfterApproval } = require('../workflows/workflowEngine');
    await resumeWorkflowAfterApproval(
      approval.workflowId.toString(),
      approval.executionId,
      action === 'approved'
    );
  }

  logger.info('Approval reviewed', {
    approvalId,
    action,
    reviewerId,
    tenantId,
  });

  return approval;
}

// ─── Cancel approval ──────────────────────────────────────────────────────────
async function cancelApproval(approvalId, tenantId, requesterId) {
  const approval = await Approval.findOne({
    _id: approvalId,
    tenantId,
    status: 'pending',
  });

  if (!approval) throw new NotFoundError('Pending approval');

  approval.status = 'cancelled';
  approval.auditTrail.push({
    action: 'APPROVAL_CANCELLED',
    actor: requesterId,
    actorId: requesterId,
  });

  await approval.save();
  logger.info('Approval cancelled', { approvalId, tenantId });
  return approval;
}

// ─── Get approval stats ───────────────────────────────────────────────────────
async function getApprovalStats(tenantId) {
  const stats = await Approval.aggregate([
    {
      $match: {
        tenantId: require('mongoose').Types.ObjectId.createFromHexString(tenantId.toString()),
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgResolutionMs: {
          $avg: {
            $cond: [
              { $ne: ['$reviewedAt', null] },
              { $subtract: ['$reviewedAt', '$createdAt'] },
              null,
            ],
          },
        },
      },
    },
  ]);

  const result = { pending: 0, approved: 0, rejected: 0, expired: 0, cancelled: 0 };
  stats.forEach((s) => {
    result[s._id] = s.count;
  });

  return result;
}

module.exports = {
  createApproval,
  listApprovals,
  getApproval,
  reviewApproval,
  cancelApproval,
  getApprovalStats,
};
