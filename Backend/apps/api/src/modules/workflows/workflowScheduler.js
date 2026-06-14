'use strict';

const cron = require('node-cron');
const { Workflow } = require('./workflow.model');
const { executeWorkflow } = require('./workflowEngine');
const logger = require('../../common/utils/logger');

const scheduledJobs = new Map();

// ─── Start the scheduler ──────────────────────────────────────────────────────
async function startScheduler() {
  logger.info('Workflow scheduler starting...');

  // Load all scheduled workflows on startup
  await loadScheduledWorkflows();

  // Refresh scheduled workflows every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await syncScheduledWorkflows();
  });

  logger.info('Workflow scheduler started');
}

// ─── Load all enabled scheduled workflows ────────────────────────────────────
async function loadScheduledWorkflows() {
  try {
    const workflows = await Workflow.find({
      'trigger.type': 'schedule',
      'trigger.schedule': { $ne: null },
      enabled: true,
      isActive: true,
    }).select('_id tenantId name trigger');

    for (const workflow of workflows) {
      scheduleWorkflow(workflow);
    }

    logger.info(`Loaded ${workflows.length} scheduled workflows`);
  } catch (err) {
    logger.error('Failed to load scheduled workflows', { error: err.message });
  }
}

// ─── Schedule a single workflow ───────────────────────────────────────────────
function scheduleWorkflow(workflow) {
  const { schedule } = workflow.trigger;

  if (!schedule || !cron.validate(schedule)) {
    logger.warn('Invalid cron expression', {
      workflowId: workflow._id,
      schedule,
    });
    return;
  }

  // Remove existing job if any
  unscheduleWorkflow(workflow._id.toString());

  const job = cron.schedule(
    schedule,
    async () => {
      logger.info('Scheduled workflow triggered', {
        workflowId: workflow._id,
        name: workflow.name,
        schedule,
      });

      try {
        await executeWorkflow({
          workflowId: workflow._id.toString(),
          triggeredBy: 'schedule',
          payload: { scheduledAt: new Date().toISOString() },
          tenantId: workflow.tenantId,
        });
      } catch (err) {
        logger.error('Scheduled workflow execution failed', {
          workflowId: workflow._id,
          error: err.message,
        });
      }
    },
    {
      scheduled: true,
      timezone: 'UTC',
    }
  );

  scheduledJobs.set(workflow._id.toString(), job);

  logger.debug('Workflow scheduled', {
    workflowId: workflow._id,
    name: workflow.name,
    schedule,
  });
}

// ─── Unschedule a workflow ────────────────────────────────────────────────────
function unscheduleWorkflow(workflowId) {
  const existing = scheduledJobs.get(workflowId);
  if (existing) {
    existing.stop();
    scheduledJobs.delete(workflowId);
  }
}

// ─── Sync scheduled workflows (add new, remove disabled) ─────────────────────
async function syncScheduledWorkflows() {
  try {
    const activeWorkflows = await Workflow.find({
      'trigger.type': 'schedule',
      enabled: true,
      isActive: true,
    }).select('_id tenantId name trigger');

    const activeIds = new Set(activeWorkflows.map((w) => w._id.toString()));

    // Remove jobs for disabled/deleted workflows
    for (const [id] of scheduledJobs) {
      if (!activeIds.has(id)) {
        unscheduleWorkflow(id);
        logger.info('Workflow unscheduled (disabled)', { workflowId: id });
      }
    }

    // Add new jobs
    for (const workflow of activeWorkflows) {
      if (!scheduledJobs.has(workflow._id.toString())) {
        scheduleWorkflow(workflow);
      }
    }
  } catch (err) {
    logger.error('Workflow scheduler sync failed', { error: err.message });
  }
}

// ─── Stop all scheduled jobs ──────────────────────────────────────────────────
function stopScheduler() {
  for (const [id, job] of scheduledJobs) {
    job.stop();
    scheduledJobs.delete(id);
  }
  logger.info('Workflow scheduler stopped');
}

// ─── Register or update a workflow's schedule ─────────────────────────────────
async function registerWorkflow(workflowId) {
  const workflow = await Workflow.findById(workflowId).select(
    '_id tenantId name trigger enabled isActive'
  );

  if (!workflow) return;

  if (workflow.trigger.type === 'schedule' && workflow.enabled && workflow.isActive) {
    scheduleWorkflow(workflow);
  } else {
    unscheduleWorkflow(workflowId);
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  registerWorkflow,
  unscheduleWorkflow,
};
