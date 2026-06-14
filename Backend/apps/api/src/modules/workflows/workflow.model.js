'use strict';

const mongoose = require('mongoose');

// ─── Workflow Step Schema ─────────────────────────────────────────────────────
const stepSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['action', 'condition', 'delay', 'approval', 'agent_task'],
      required: true,
    },
    integration: {
      type: String,
      enum: [
        'jira',
        'slack',
        'zendesk',
        'salesforce',
        'hubspot',
        'notion',
        'gsheets',
        'internal',
        'agent',
      ],
      default: 'internal',
    },
    action: { type: String, required: true },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    condition: {
      field: String,
      operator: {
        type: String,
        enum: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'exists'],
      },
      value: mongoose.Schema.Types.Mixed,
    },
    onSuccess: { type: String, default: null }, // next stepId
    onFailure: { type: String, default: null }, // next stepId or 'stop'
    retryPolicy: {
      maxAttempts: { type: Number, default: 3 },
      backoffMs: { type: Number, default: 1000 },
      backoffMultiplier: { type: Number, default: 2 },
    },
    timeoutMs: { type: Number, default: 30000 },
  },
  { _id: false }
);

// ─── Workflow Execution Log Schema ────────────────────────────────────────────
const executionLogSchema = new mongoose.Schema(
  {
    executionId: { type: String, required: true },
    triggeredBy: {
      type: String,
      enum: ['event', 'schedule', 'manual', 'webhook'],
      required: true,
    },
    triggerPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'cancelled', 'pending_approval'],
      default: 'running',
    },
    steps: [
      {
        stepId: String,
        stepName: String,
        status: {
          type: String,
          enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
          default: 'pending',
        },
        attempts: { type: Number, default: 0 },
        result: mongoose.Schema.Types.Mixed,
        error: String,
        startedAt: Date,
        completedAt: Date,
        durationMs: Number,
      },
    ],
    error: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
  },
  { _id: false }
);

// ─── Workflow Schema ──────────────────────────────────────────────────────────
const workflowSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: { type: String, default: '', maxlength: 500 },
    enabled: { type: Boolean, default: false, index: true },
    version: { type: Number, default: 1 },

    // ─── Trigger ──────────────────────────────────────────
    trigger: {
      type: {
        type: String,
        enum: ['event', 'schedule', 'webhook', 'manual'],
        required: true,
      },
      // Event trigger
      eventType: {
        type: String,
        enum: [
          'TICKET_CREATED',
          'TICKET_UPDATED',
          'TICKET_ESCALATED',
          'CHURN_RISK_DETECTED',
          'REVENUE_DROP_DETECTED',
          'CRITICAL_INCIDENT_OPENED',
          'INCIDENT_RESOLVED',
          'SLA_BREACH_RISK',
          'APPROVAL_APPROVED',
          'APPROVAL_REJECTED',
          'AGENT_TASK_COMPLETED',
          'CUSTOM',
        ],
        default: null,
      },
      // Schedule trigger (cron expression)
      schedule: { type: String, default: null },
      // Webhook trigger
      webhookSecret: { type: String, default: null },
      // Filter conditions on trigger payload
      filters: [
        {
          field: String,
          operator: {
            type: String,
            enum: ['eq', 'neq', 'gt', 'lt', 'contains', 'exists'],
          },
          value: mongoose.Schema.Types.Mixed,
        },
      ],
    },

    // ─── Steps ────────────────────────────────────────────
    steps: {
      type: [stepSchema],
      validate: {
        validator: (steps) => steps.length > 0 && steps.length <= 20,
        message: 'Workflow must have between 1 and 20 steps',
      },
    },

    // ─── Global retry / DLQ settings ──────────────────────
    globalRetryPolicy: {
      maxAttempts: { type: Number, default: 3 },
      backoffMs: { type: Number, default: 2000 },
    },
    dlqEnabled: { type: Boolean, default: true },
    dlqThreshold: { type: Number, default: 3 },

    // ─── Stats ────────────────────────────────────────────
    totalRuns: { type: Number, default: 0 },
    successfulRuns: { type: Number, default: 0 },
    failedRuns: { type: Number, default: 0 },
    lastRunAt: { type: Date, default: null },
    lastRunStatus: {
      type: String,
      enum: ['completed', 'failed', 'running', null],
      default: null,
    },

    // Recent executions (capped at 30)
    executions: { type: [executionLogSchema], default: [] },

    // Dead letter queue entries
    dlq: [
      {
        executionId: String,
        failedAt: Date,
        error: String,
        payload: mongoose.Schema.Types.Mixed,
        retryCount: { type: Number, default: 0 },
        resolvedAt: { type: Date, default: null },
      },
    ],

    tags: [{ type: String, maxlength: 50 }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'workflows',
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
workflowSchema.index({ tenantId: 1, enabled: 1 });
workflowSchema.index({ tenantId: 1, 'trigger.eventType': 1 });
workflowSchema.index({ tenantId: 1, isActive: 1 });

// ─── Keep only last 30 executions ─────────────────────────────────────────────
workflowSchema.pre('save', function (next) {
  if (this.executions.length > 30) {
    this.executions = this.executions.slice(-30);
  }
  next();
});

// ─── Virtual: success rate ────────────────────────────────────────────────────
workflowSchema.virtual('successRate').get(function () {
  if (this.totalRuns === 0) return 100;
  return Math.round((this.successfulRuns / this.totalRuns) * 100);
});

workflowSchema.set('toJSON', { virtuals: true });

const Workflow = mongoose.model('Workflow', workflowSchema);

module.exports = { Workflow };
