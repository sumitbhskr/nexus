'use strict';

const { Agent } = require('./agent.model');
const { runAgentTask } = require('./agentRunner');
const {
  NotFoundError,
  ValidationError,
  AppError,
} = require('../../common/middleware/errorHandler');
const logger = require('../../common/utils/logger');

// ─── Default agents seeded per tenant ────────────────────────────────────────
const DEFAULT_AGENTS = [
  {
    name: 'Customer Success Agent',
    type: 'customer_success',
    description: 'Monitors customer health, flags churn risks, and recommends CSM actions',
    config: {
      enabledTools: [
        'searchKnowledgeBase',
        'getSalesforceAccounts',
        'getZendeskTickets',
        'createApproval',
        'postSlackMessage',
        'getDashboardMetrics',
      ],
    },
  },
  {
    name: 'Support Agent',
    type: 'support',
    description: 'Triages support tickets, detects SLA breach risks, and escalates to engineering',
    config: {
      enabledTools: [
        'searchKnowledgeBase',
        'getZendeskTickets',
        'createJiraIssue',
        'postSlackMessage',
        'createApproval',
      ],
    },
  },
  {
    name: 'Revenue Agent',
    type: 'revenue',
    description: 'Tracks MRR trends, pipeline health, and expansion opportunities',
    config: {
      enabledTools: [
        'getSalesforceAccounts',
        'getDashboardMetrics',
        'searchKnowledgeBase',
        'createApproval',
        'postSlackMessage',
      ],
    },
  },
  {
    name: 'Incident Response Agent',
    type: 'incident_response',
    description: 'Detects, triages, and coordinates production incident response',
    config: {
      enabledTools: [
        'searchKnowledgeBase',
        'createJiraIssue',
        'postSlackMessage',
        'createApproval',
        'getDashboardMetrics',
      ],
    },
  },
  {
    name: 'Operations Agent',
    type: 'operations',
    description: 'Monitors workflow health, system performance, and operational metrics',
    config: {
      enabledTools: [
        'searchKnowledgeBase',
        'getDashboardMetrics',
        'queryDatabase',
        'createJiraIssue',
        'postSlackMessage',
      ],
    },
  },
];

// ─── Seed default agents for new tenant ───────────────────────────────────────
async function seedAgentsForTenant(tenantId, createdBy) {
  const existing = await Agent.countDocuments({ tenantId });
  if (existing > 0) return;

  const agents = DEFAULT_AGENTS.map((a) => ({ ...a, tenantId, createdBy }));
  await Agent.insertMany(agents);

  logger.info('Default agents seeded for tenant', {
    tenantId,
    count: DEFAULT_AGENTS.length,
  });
}

// ─── List all agents ──────────────────────────────────────────────────────────
async function listAgents(tenantId) {
  const agents = await Agent.find({ tenantId, isActive: true })
    .select('-executions -memory')
    .sort({ type: 1 })
    .lean({ virtuals: true });

  return agents;
}

// ─── Get agent by ID ──────────────────────────────────────────────────────────
async function getAgent(agentId, tenantId) {
  const agent = await Agent.findOne({ _id: agentId, tenantId, isActive: true }).lean({
    virtuals: true,
  });

  if (!agent) throw new NotFoundError('Agent');
  return agent;
}

// ─── Get agent executions ─────────────────────────────────────────────────────
async function getAgentExecutions(agentId, tenantId, limit = 20) {
  const agent = await Agent.findOne({ _id: agentId, tenantId }).select('executions name type');

  if (!agent) throw new NotFoundError('Agent');

  return {
    agentId,
    name: agent.name,
    executions: agent.executions
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, limit),
  };
}

// ─── Run agent task ───────────────────────────────────────────────────────────
async function executeTask({ agentId, task, tenantId }) {
  if (!task || task.trim().length < 3) {
    throw new ValidationError('Task description must be at least 3 characters');
  }

  if (task.length > 2000) {
    throw new ValidationError('Task description cannot exceed 2000 characters');
  }

  const agent = await Agent.findOne({ _id: agentId, tenantId, isActive: true });
  if (!agent) throw new NotFoundError('Agent');

  if (agent.status === 'running') {
    throw new AppError('Agent is already running a task', 409, 'AGENT_BUSY');
  }

  // Run asynchronously — return taskId immediately
  const taskId = require('uuid').v4();

  // Fire and forget with error handling
  runAgentTask({ agentId, task, tenantId }).catch((err) => {
    logger.error('Background agent task failed', {
      agentId,
      taskId,
      error: err.message,
    });
  });

  return {
    taskId,
    agentId,
    status: 'started',
    message: 'Agent task started — subscribe to WebSocket for real-time updates',
  };
}

// ─── Update agent config ──────────────────────────────────────────────────────
async function updateAgentConfig(agentId, tenantId, updates) {
  const allowed = ['config', 'description', 'name'];
  const sanitized = {};
  allowed.forEach((key) => {
    if (updates[key] !== undefined) sanitized[key] = updates[key];
  });

  const agent = await Agent.findOneAndUpdate(
    { _id: agentId, tenantId },
    { $set: sanitized },
    { new: true, runValidators: true }
  );

  if (!agent) throw new NotFoundError('Agent');
  return agent;
}

// ─── Pause / resume agent ─────────────────────────────────────────────────────
async function setAgentStatus(agentId, tenantId, status) {
  const allowed = ['paused', 'idle'];
  if (!allowed.includes(status)) {
    throw new ValidationError(`Status must be one of: ${allowed.join(', ')}`);
  }

  const agent = await Agent.findOneAndUpdate(
    { _id: agentId, tenantId, status: { $ne: 'running' } },
    { $set: { status } },
    { new: true }
  );

  if (!agent) throw new AppError('Cannot change status of a running agent', 409, 'AGENT_BUSY');
  return agent;
}

// ─── Get agent memory ─────────────────────────────────────────────────────────
async function getAgentMemory(agentId, tenantId) {
  const agent = await Agent.findOne({ _id: agentId, tenantId }).select('memory name');
  if (!agent) throw new NotFoundError('Agent');
  return { agentId, name: agent.name, memory: agent.memory };
}

// ─── Clear agent memory ───────────────────────────────────────────────────────
async function clearAgentMemory(agentId, tenantId) {
  await Agent.findOneAndUpdate({ _id: agentId, tenantId }, { $set: { memory: [] } });
  logger.info('Agent memory cleared', { agentId, tenantId });
}

module.exports = {
  seedAgentsForTenant,
  listAgents,
  getAgent,
  getAgentExecutions,
  executeTask,
  updateAgentConfig,
  setAgentStatus,
  getAgentMemory,
  clearAgentMemory,
};
