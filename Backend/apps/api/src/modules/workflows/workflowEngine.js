'use strict';

const { v4: uuidv4 } = require('uuid');
const { Workflow } = require('./workflow.model');
const { emitWorkflowUpdate } = require('../../config/socket');
const logger = require('../../common/utils/logger');

// ─── Step executors by integration + action ───────────────────────────────────
const STEP_EXECUTORS = {
  // ─── Slack ────────────────────────────────────────────
  'slack:postMessage': async (params, context) => {
    const { SlackConnector } = require('../integrations/slack/slack.connector');
    const connector = new SlackConnector(context.tenantId);
    return connector.postMessage({
      channel: interpolate(params.channel, context.payload),
      text: interpolate(params.message, context.payload),
    });
  },

  // ─── Jira ─────────────────────────────────────────────
  'jira:createIssue': async (params, context) => {
    const { JiraConnector } = require('../integrations/jira/jira.connector');
    const connector = new JiraConnector(context.tenantId);
    return connector.createIssue({
      title: interpolate(params.title, context.payload),
      description: interpolate(params.description, context.payload),
      priority: params.priority || 'Medium',
      issueType: params.issueType || 'Task',
    });
  },

  'jira:updateIssue': async (params, context) => {
    const { JiraConnector } = require('../integrations/jira/jira.connector');
    const connector = new JiraConnector(context.tenantId);
    return connector.updateIssue(params.issueKey, params.updates);
  },

  // ─── Zendesk ──────────────────────────────────────────
  'zendesk:updateTicket': async (params, context) => {
    const { ZendeskConnector } = require('../integrations/zendesk/zendesk.connector');
    const connector = new ZendeskConnector(context.tenantId);
    return connector.updateTicket(interpolate(params.ticketId, context.payload), {
      priority: params.priority,
      status: params.status,
      tags: params.tags,
    });
  },

  'zendesk:addComment': async (params, context) => {
    const { ZendeskConnector } = require('../integrations/zendesk/zendesk.connector');
    const connector = new ZendeskConnector(context.tenantId);
    return connector.addComment(
      interpolate(params.ticketId, context.payload),
      interpolate(params.comment, context.payload)
    );
  },

  // ─── Approvals ────────────────────────────────────────
  'internal:createApproval': async (params, context) => {
    const approvalService = require('../approvals/approval.service');
    const approval = await approvalService.createApproval({
      tenantId: context.tenantId,
      action: interpolate(params.action, context.payload),
      detail: interpolate(params.detail, context.payload),
      risk: params.risk || 'medium',
      workflowId: context.workflowId,
      executionId: context.executionId,
      payload: context.payload,
    });
    // Pause workflow — resume when approved
    context.pauseForApproval = true;
    context.approvalId = approval._id.toString();
    return { approvalId: approval._id, status: 'pending' };
  },

  // ─── Agent task ───────────────────────────────────────
  'agent:runTask': async (params, context) => {
    const agentService = require('../agents/agent.service');
    return agentService.executeTask({
      agentId: params.agentId,
      task: interpolate(params.task, context.payload),
      tenantId: context.tenantId,
    });
  },

  // ─── Internal: delay ─────────────────────────────────
  'internal:delay': async (params) => {
    const ms = params.delayMs || 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 30000)));
    return { delayed: ms };
  },

  // ─── Internal: condition ──────────────────────────────
  'internal:condition': async (params, context) => {
    const value = getNestedValue(context.payload, params.field);
    const result = evaluateCondition(value, params.operator, params.value);
    return { conditionMet: result, field: params.field, value };
  },
};

// ─── Template interpolation: {{field}} → payload.field ───────────────────────
function interpolate(template, payload) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
    const val = getNestedValue(payload, path);
    return val !== undefined ? String(val) : `{{${path}}}`;
  });
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function evaluateCondition(value, operator, target) {
  switch (operator) {
    case 'eq':
      return value === target;
    case 'neq':
      return value !== target;
    case 'gt':
      return Number(value) > Number(target);
    case 'lt':
      return Number(value) < Number(target);
    case 'gte':
      return Number(value) >= Number(target);
    case 'lte':
      return Number(value) <= Number(target);
    case 'contains':
      return String(value).includes(String(target));
    case 'exists':
      return value !== undefined && value !== null;
    default:
      return false;
  }
}

// ─── Execute a single step with retry ────────────────────────────────────────
async function executeStep(step, context, stepLog) {
  const executorKey = `${step.integration}:${step.action}`;
  const executor = STEP_EXECUTORS[executorKey];

  if (!executor) {
    throw new Error(`No executor found for ${executorKey}`);
  }

  const maxAttempts = step.retryPolicy?.maxAttempts || 3;
  const backoffMs = step.retryPolicy?.backoffMs || 1000;
  const multiplier = step.retryPolicy?.backoffMultiplier || 2;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    stepLog.attempts = attempt;
    stepLog.status = 'running';
    stepLog.startedAt = new Date();

    try {
      const result = await Promise.race([
        executor(step.params, context),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Step timeout after ${step.timeoutMs}ms`)),
            step.timeoutMs || 30000
          )
        ),
      ]);

      stepLog.status = 'completed';
      stepLog.result = result;
      stepLog.completedAt = new Date();
      stepLog.durationMs = Date.now() - stepLog.startedAt.getTime();

      return result;
    } catch (err) {
      lastError = err;
      stepLog.error = err.message;

      logger.warn('Workflow step failed', {
        workflowId: context.workflowId,
        stepId: step.id,
        attempt,
        maxAttempts,
        error: err.message,
      });

      if (attempt < maxAttempts) {
        const delay = backoffMs * Math.pow(multiplier, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  stepLog.status = 'failed';
  stepLog.completedAt = new Date();
  stepLog.durationMs = Date.now() - stepLog.startedAt.getTime();

  throw lastError;
}

// ─── Main workflow execution engine ──────────────────────────────────────────
async function executeWorkflow({ workflowId, triggeredBy, payload = {}, tenantId }) {
  const workflow = await Workflow.findOne({
    _id: workflowId,
    tenantId,
    isActive: true,
  });

  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  if (!workflow.enabled) {
    logger.info('Workflow skipped — disabled', { workflowId });
    return { status: 'skipped', reason: 'Workflow is disabled' };
  }

  const executionId = uuidv4();
  const startTime = Date.now();

  // Build execution log
  const executionLog = {
    executionId,
    triggeredBy,
    triggerPayload: payload,
    status: 'running',
    steps: workflow.steps.map((s) => ({
      stepId: s.id,
      stepName: s.name,
      status: 'pending',
      attempts: 0,
    })),
    startedAt: new Date(),
  };

  workflow.executions.push(executionLog);
  workflow.totalRuns += 1;
  workflow.lastRunAt = new Date();
  workflow.lastRunStatus = 'running';
  await workflow.save();

  const executionRef = workflow.executions[workflow.executions.length - 1];

  emitWorkflowUpdate(workflowId, {
    executionId,
    status: 'running',
    triggeredBy,
  });

  // Build execution context
  const context = {
    tenantId,
    workflowId: workflow._id.toString(),
    executionId,
    payload,
    pauseForApproval: false,
    approvalId: null,
    stepResults: {},
  };

  let currentStepId = workflow.steps[0]?.id;
  let executionStatus = 'completed';
  let executionError = null;

  try {
    // ─── Step execution loop ──────────────────────────────
    while (currentStepId) {
      const step = workflow.steps.find((s) => s.id === currentStepId);

      if (!step) {
        logger.warn('Step not found in workflow', { workflowId, currentStepId });
        break;
      }

      const stepLog = executionRef.steps.find((s) => s.stepId === step.id);
      if (!stepLog) break;

      emitWorkflowUpdate(workflowId, {
        executionId,
        currentStep: step.id,
        stepName: step.name,
      });

      try {
        const result = await executeStep(step, context, stepLog);
        context.stepResults[step.id] = result;

        // Merge step result into payload for template interpolation
        if (result && typeof result === 'object') {
          context.payload = { ...context.payload, ...result };
        }

        // Check if paused for approval
        if (context.pauseForApproval) {
          executionStatus = 'pending_approval';
          executionRef.status = 'pending_approval';

          logger.info('Workflow paused for approval', {
            workflowId,
            executionId,
            approvalId: context.approvalId,
          });

          emitWorkflowUpdate(workflowId, {
            executionId,
            status: 'pending_approval',
            approvalId: context.approvalId,
          });

          // Save and exit — will be resumed by approval service
          await workflow.save();
          return { executionId, status: 'pending_approval', approvalId: context.approvalId };
        }

        // Determine next step
        if (step.type === 'condition') {
          const conditionMet = result?.conditionMet;
          currentStepId = conditionMet ? step.onSuccess : step.onFailure;
        } else {
          currentStepId = step.onSuccess || null;
        }
      } catch (stepErr) {
        logger.error('Workflow step failed after retries', {
          workflowId,
          executionId,
          stepId: step.id,
          error: stepErr.message,
        });

        // Add to DLQ if enabled
        if (workflow.dlqEnabled) {
          workflow.dlq.push({
            executionId,
            failedAt: new Date(),
            error: stepErr.message,
            payload,
            retryCount: 0,
          });
        }

        // Follow failure path or stop
        if (step.onFailure && step.onFailure !== 'stop') {
          currentStepId = step.onFailure;
        } else {
          executionStatus = 'failed';
          executionError = stepErr.message;
          break;
        }
      }
    }
  } catch (err) {
    executionStatus = 'failed';
    executionError = err.message;

    logger.error('Workflow execution failed', {
      workflowId,
      executionId,
      error: err.message,
    });
  }

  // ─── Finalize execution ───────────────────────────────
  const durationMs = Date.now() - startTime;

  executionRef.status = executionStatus;
  executionRef.error = executionError;
  executionRef.completedAt = new Date();
  executionRef.durationMs = durationMs;

  if (executionStatus === 'completed') {
    workflow.successfulRuns += 1;
  } else if (executionStatus === 'failed') {
    workflow.failedRuns += 1;
  }

  workflow.lastRunStatus = executionStatus;
  await workflow.save();

  emitWorkflowUpdate(workflowId, {
    executionId,
    status: executionStatus,
    durationMs,
    error: executionError,
  });

  logger.info('Workflow execution finished', {
    workflowId,
    executionId,
    status: executionStatus,
    durationMs,
  });

  return { executionId, status: executionStatus, durationMs };
}

// ─── Resume workflow after approval ──────────────────────────────────────────
async function resumeWorkflowAfterApproval(workflowId, executionId, approved) {
  const workflow = await Workflow.findById(workflowId);
  if (!workflow) return;

  const execution = workflow.executions.find((e) => e.executionId === executionId);
  if (!execution) return;

  if (!approved) {
    execution.status = 'cancelled';
    execution.completedAt = new Date();
    workflow.failedRuns += 1;
    workflow.lastRunStatus = 'failed';
    await workflow.save();
    return;
  }

  // Find the step that was pending and continue from next
  const pendingStep = execution.steps.find((s) => s.status === 'pending');
  if (!pendingStep) return;

  // Re-trigger from next step
  const step = workflow.steps.find((s) => s.id === pendingStep.stepId);
  if (step?.onSuccess) {
    await executeWorkflow({
      workflowId,
      triggeredBy: 'event',
      payload: execution.triggerPayload,
      tenantId: workflow.tenantId,
    });
  }
}

module.exports = { executeWorkflow, resumeWorkflowAfterApproval };
