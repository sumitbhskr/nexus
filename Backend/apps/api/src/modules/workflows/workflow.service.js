'use strict';

const { Workflow } = require('./workflow.model');
const { executeWorkflow } = require('./workflowEngine');
const { registerWorkflow, unscheduleWorkflow } = require('./workflowScheduler');
const {
  NotFoundError,
  ValidationError,
  AppError,
} = require('../../common/middleware/errorHandler');
const logger = require('../../common/utils/logger');
const { v4: uuidv4 } = require('uuid');

// ─── Validate trigger ─────────────────────────────────────────────────────────
function validateTrigger(trigger) {
  if (!trigger?.type) throw new ValidationError('trigger.type is required');

  if (trigger.type === 'schedule') {
    if (!trigger.schedule)
      throw new ValidationError('trigger.schedule (cron) required for scheduled workflows');
    const cron = require('node-cron');
    if (!cron.validate(trigger.schedule)) {
      throw new ValidationError(`Invalid cron expression: ${trigger.schedule}`);
    }
  }

  if (trigger.type === 'event' && !trigger.eventType) {
    throw new ValidationError('trigger.eventType is required for event-triggered workflows');
  }
}

// ─── Validate steps ───────────────────────────────────────────────────────────
function validateSteps(steps) {
  if (!steps || steps.length === 0) {
    throw new ValidationError('Workflow must have at least one step');
  }

  if (steps.length > 20) {
    throw new ValidationError('Workflow cannot have more than 20 steps');
  }

  const ids = steps.map((s) => s.id);
  const uniqueIds = new Set(ids);
  if (ids.length !== uniqueIds.size) {
    throw new ValidationError('Step IDs must be unique within a workflow');
  }

  // Ensure onSuccess/onFailure references are valid
  for (const step of steps) {
    if (step.onSuccess && !uniqueIds.has(step.onSuccess)) {
      throw new ValidationError(
        `Step '${step.id}' references non-existent onSuccess step '${step.onSuccess}'`
      );
    }
    if (step.onFailure && step.onFailure !== 'stop' && !uniqueIds.has(step.onFailure)) {
      throw new ValidationError(
        `Step '${step.id}' references non-existent onFailure step '${step.onFailure}'`
      );
    }
  }
}

// ─── Create workflow ──────────────────────────────────────────────────────────
async function createWorkflow(tenantId, userId, data) {
  validateTrigger(data.trigger);
  validateSteps(data.steps);

  // Auto-generate step IDs if not provided
  const steps = data.steps.map((step) => ({
    ...step,
    id: step.id || uuidv4().slice(0, 8),
  }));

  const workflow = await Workflow.create({
    tenantId,
    name: data.name,
    description: data.description || '',
    enabled: data.enabled || false,
    trigger: data.trigger,
    steps,
    globalRetryPolicy: data.globalRetryPolicy,
    dlqEnabled: data.dlqEnabled !== false,
    tags: data.tags || [],
    createdBy: userId,
  });

  // Register with scheduler if scheduled
  await registerWorkflow(workflow._id.toString());

  logger.info('Workflow created', {
    workflowId: workflow._id,
    tenantId,
    name: workflow.name,
    triggerType: workflow.trigger.type,
  });

  return workflow;
}

// ─── List workflows ───────────────────────────────────────────────────────────
async function listWorkflows(tenantId, { enabled, page = 1, limit = 20 } = {}) {
  const filter = { tenantId, isActive: true };
  if (enabled !== undefined) filter.enabled = enabled;

  const skip = (page - 1) * limit;

  const [workflows, total] = await Promise.all([
    Workflow.find(filter)
      .select('-executions -dlq')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true }),
    Workflow.countDocuments(filter),
  ]);

  return {
    workflows,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
}

// ─── Get workflow by ID ───────────────────────────────────────────────────────
async function getWorkflow(workflowId, tenantId) {
  const workflow = await Workflow.findOne({ _id: workflowId, tenantId, isActive: true }).lean({
    virtuals: true,
  });

  if (!workflow) throw new NotFoundError('Workflow');
  return workflow;
}

// ─── Update workflow ──────────────────────────────────────────────────────────
async function updateWorkflow(workflowId, tenantId, updates) {
  if (updates.trigger) validateTrigger(updates.trigger);
  if (updates.steps) validateSteps(updates.steps);

  const workflow = await Workflow.findOne({ _id: workflowId, tenantId, isActive: true });
  if (!workflow) throw new NotFoundError('Workflow');

  // Increment version on structural changes
  if (updates.steps || updates.trigger) {
    updates.version = workflow.version + 1;
  }

  Object.assign(workflow, updates);
  await workflow.save();

  // Re-register with scheduler
  await registerWorkflow(workflowId);

  logger.info('Workflow updated', { workflowId, tenantId });
  return workflow;
}

// ─── Toggle workflow enabled/disabled ─────────────────────────────────────────
async function toggleWorkflow(workflowId, tenantId, enabled) {
  const workflow = await Workflow.findOneAndUpdate(
    { _id: workflowId, tenantId, isActive: true },
    { $set: { enabled } },
    { new: true }
  );

  if (!workflow) throw new NotFoundError('Workflow');

  await registerWorkflow(workflowId);

  logger.info(`Workflow ${enabled ? 'enabled' : 'disabled'}`, { workflowId, tenantId });
  return workflow;
}

// ─── Delete workflow (soft delete) ────────────────────────────────────────────
async function deleteWorkflow(workflowId, tenantId) {
  const workflow = await Workflow.findOneAndUpdate(
    { _id: workflowId, tenantId },
    { $set: { isActive: false, enabled: false } },
    { new: true }
  );

  if (!workflow) throw new NotFoundError('Workflow');

  unscheduleWorkflow(workflowId);

  logger.info('Workflow deleted', { workflowId, tenantId });
}

// ─── Manually trigger workflow ────────────────────────────────────────────────
async function triggerWorkflow(workflowId, tenantId, payload = {}) {
  const workflow = await Workflow.findOne({ _id: workflowId, tenantId, isActive: true });
  if (!workflow) throw new NotFoundError('Workflow');

  if (!workflow.enabled) {
    throw new AppError('Cannot trigger a disabled workflow', 400, 'WORKFLOW_DISABLED');
  }

  const result = await executeWorkflow({
    workflowId,
    triggeredBy: 'manual',
    payload,
    tenantId,
  });

  return result;
}

// ─── Get workflow executions ──────────────────────────────────────────────────
async function getWorkflowExecutions(workflowId, tenantId, limit = 20) {
  const workflow = await Workflow.findOne({ _id: workflowId, tenantId }).select('name executions');

  if (!workflow) throw new NotFoundError('Workflow');

  return {
    workflowId,
    name: workflow.name,
    executions: workflow.executions
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, limit),
  };
}

// ─── Get DLQ ─────────────────────────────────────────────────────────────────
async function getDLQ(tenantId, limit = 50) {
  const workflows = await Workflow.find({ tenantId, 'dlq.0': { $exists: true } }).select(
    'name dlq'
  );

  const dlqEntries = [];
  for (const wf of workflows) {
    for (const entry of wf.dlq) {
      if (!entry.resolvedAt) {
        dlqEntries.push({
          workflowId: wf._id,
          workflowName: wf.name,
          ...entry.toObject(),
        });
      }
    }
  }

  return dlqEntries.sort((a, b) => new Date(b.failedAt) - new Date(a.failedAt)).slice(0, limit);
}

// ─── Trigger workflow by event type ──────────────────────────────────────────
async function triggerByEvent(tenantId, eventType, payload) {
  const workflows = await Workflow.find({
    tenantId,
    'trigger.type': 'event',
    'trigger.eventType': eventType,
    enabled: true,
    isActive: true,
  });

  if (workflows.length === 0) return;

  logger.info('Triggering workflows by event', {
    tenantId,
    eventType,
    count: workflows.length,
  });

  // Execute matching workflows (check filters)
  const executions = await Promise.allSettled(
    workflows
      .filter((wf) => matchesFilters(wf.trigger.filters, payload))
      .map((wf) =>
        executeWorkflow({
          workflowId: wf._id.toString(),
          triggeredBy: 'event',
          payload,
          tenantId,
        })
      )
  );

  const failed = executions.filter((e) => e.status === 'rejected').length;
  if (failed > 0) {
    logger.warn(`${failed} workflow(s) failed on event trigger`, { eventType });
  }
}

// ─── Check if payload matches workflow trigger filters ────────────────────────
function matchesFilters(filters, payload) {
  if (!filters || filters.length === 0) return true;

  return filters.every((filter) => {
    const value = filter.field.split('.').reduce((acc, k) => acc?.[k], payload);
    switch (filter.operator) {
      case 'eq':
        return value === filter.value;
      case 'neq':
        return value !== filter.value;
      case 'gt':
        return Number(value) > Number(filter.value);
      case 'lt':
        return Number(value) < Number(filter.value);
      case 'contains':
        return String(value || '').includes(String(filter.value));
      case 'exists':
        return value !== undefined && value !== null;
      default:
        return true;
    }
  });
}

module.exports = {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  updateWorkflow,
  toggleWorkflow,
  deleteWorkflow,
  triggerWorkflow,
  getWorkflowExecutions,
  getDLQ,
  triggerByEvent,
};
