'use strict';

const mongoose = require('mongoose');

const auditEntrySchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now },
    action: { type: String, required: true },
    actor: { type: String, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const approvalSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,

    },
    action: { type: String, required: true, maxlength: 200 },
    detail: { type: String, required: true, maxlength: 2000 },
    risk: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,

    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired', 'cancelled'],
      default: 'pending',

    },

    // Requester (agent or user)
    requestedBy: {
      agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
      agentType: { type: String, default: null },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      source: {
        type: String,
        enum: ['agent', 'workflow', 'user', 'system'],
        default: 'agent',
      },
    },

    // Reviewer
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null, maxlength: 500 },

    // Workflow context
    workflowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workflow',
      default: null,
    },
    executionId: { type: String, default: null },

    // Payload to execute on approval
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Expiry
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h

    },

    // Immutable audit trail
    auditTrail: { type: [auditEntrySchema], default: [] },

    notificationsSent: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'approvals',
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
approvalSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
approvalSchema.index({ tenantId: 1, risk: 1, status: 1 });
// Auto-expire pending approvals
approvalSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { status: 'pending' } }
);

const Approval = mongoose.model('Approval', approvalSchema);

module.exports = { Approval };
