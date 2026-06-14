'use strict';

const mongoose = require('mongoose');

// ─── Agent Execution Schema ───────────────────────────────────────────────────
const executionSchema = new mongoose.Schema(
  {
    taskId: { type: String, required: true },
    task: { type: String, required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'cancelled'],
      default: 'running',
    },
    steps: [
      {
        step: String,
        action: String,
        result: mongoose.Schema.Types.Mixed,
        durationMs: Number,
        tokensUsed: Number,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    tokensUsed: { type: Number, default: 0 },
    costUSD: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
  },
  { _id: true }
);

// ─── Agent Memory Schema ──────────────────────────────────────────────────────
const memorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    category: {
      type: String,
      enum: ['customer', 'incident', 'workflow', 'insight', 'general'],
      default: 'general',
    },
    expiresAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Agent Schema ─────────────────────────────────────────────────────────────
const agentSchema = new mongoose.Schema(
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
    },
    type: {
      type: String,
      enum: ['customer_success', 'support', 'revenue', 'incident_response', 'operations'],
      required: true,
    },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['running', 'idle', 'error', 'paused', 'initializing'],
      default: 'idle',
      index: true,
    },
    currentTask: { type: String, default: null },
    currentTaskId: { type: String, default: null },

    // Configuration
    config: {
      model: {
        type: String,
        default: () => process.env.LLM_MODEL || 'claude-sonnet-4-6',
      },
      maxTokensPerExecution: { type: Number, default: 2000 },
      temperature: { type: Number, default: 0.1 },
      maxExecutionTimeMs: { type: Number, default: 120000 },
      enabledTools: {
        type: [String],
        default: ['searchKnowledgeBase', 'createApproval'],
      },
      systemPromptOverride: { type: String, default: null },
    },

    // Cost tracking
    totalCostUSD: { type: Number, default: 0 },
    totalTokensUsed: { type: Number, default: 0 },
    totalExecutions: { type: Number, default: 0 },
    successfulExecutions: { type: Number, default: 0 },
    failedExecutions: { type: Number, default: 0 },

    // Circuit breaker
    circuitBreaker: {
      state: {
        type: String,
        enum: ['closed', 'open', 'half-open'],
        default: 'closed',
      },
      failureCount: { type: Number, default: 0 },
      lastFailureAt: { type: Date, default: null },
      openedAt: { type: Date, default: null },
      resetAfterMs: { type: Number, default: 60000 },
    },

    // Recent executions (capped at 50)
    executions: {
      type: [executionSchema],
      default: [],
    },

    // Agent memory (persistent context)
    memory: {
      type: [memorySchema],
      default: [],
    },

    lastActiveAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    collection: 'agents',
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
agentSchema.index({ tenantId: 1, type: 1 });
agentSchema.index({ tenantId: 1, status: 1 });
agentSchema.index({ tenantId: 1, isActive: 1 });

// ─── Keep only last 50 executions ────────────────────────────────────────────
agentSchema.pre('save', function (next) {
  if (this.executions.length > 50) {
    this.executions = this.executions.slice(-50);
  }
  // Clean expired memory entries
  this.memory = this.memory.filter((m) => !m.expiresAt || m.expiresAt > new Date());
  next();
});

// ─── Virtual: success rate ────────────────────────────────────────────────────
agentSchema.virtual('successRate').get(function () {
  if (this.totalExecutions === 0) return 100;
  return Math.round((this.successfulExecutions / this.totalExecutions) * 100);
});

// ─── Circuit breaker check ────────────────────────────────────────────────────
agentSchema.methods.isCircuitOpen = function () {
  const cb = this.circuitBreaker;
  if (cb.state === 'closed') return false;
  if (cb.state === 'open') {
    const elapsed = Date.now() - new Date(cb.openedAt).getTime();
    if (elapsed >= cb.resetAfterMs) {
      // Transition to half-open
      cb.state = 'half-open';
      return false;
    }
    return true;
  }
  return false;
};

agentSchema.methods.recordFailure = async function () {
  const cb = this.circuitBreaker;
  cb.failureCount += 1;
  cb.lastFailureAt = new Date();

  if (cb.failureCount >= 3) {
    cb.state = 'open';
    cb.openedAt = new Date();
  }

  this.failedExecutions += 1;
  this.status = cb.state === 'open' ? 'error' : this.status;
  await this.save();
};

agentSchema.methods.recordSuccess = async function () {
  const cb = this.circuitBreaker;
  cb.failureCount = 0;
  cb.state = 'closed';
  cb.openedAt = null;

  this.successfulExecutions += 1;
  this.status = 'idle';
  this.currentTask = null;
  this.currentTaskId = null;
  this.lastActiveAt = new Date();
  await this.save();
};

agentSchema.set('toJSON', { virtuals: true });

const Agent = mongoose.model('Agent', agentSchema);

module.exports = { Agent };
