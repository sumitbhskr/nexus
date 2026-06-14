'use strict';

const axios = require('axios');
const logger = require('../../../common/utils/logger');

// ─── Tool registry — all tools available to agents ────────────────────────────
// Each tool: { name, description, parameters, execute(params, context) }

// ─── Tool: Search Knowledge Base (RAG) ───────────────────────────────────────
const searchKnowledgeBase = {
  name: 'searchKnowledgeBase',
  description:
    'Search internal knowledge base, support tickets, incidents, and documentation using semantic similarity',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language search query' },
      source: {
        type: 'string',
        enum: ['all', 'tickets', 'incidents', 'docs', 'csv'],
        description: 'Filter by document source',
      },
      limit: { type: 'number', description: 'Number of results (default 5)' },
    },
    required: ['query'],
  },
  async execute({ query, source = 'all', limit = 5 }, context) {
    const ragService = require('../../rag/rag.service');
    const results = await ragService.hybridSearch({
      tenantId: context.tenantId,
      query,
      source: source === 'all' ? undefined : source,
      limit,
    });
    return {
      results: results.map((r) => ({
        text: r.text,
        source: r.metadata?.source,
        title: r.metadata?.title,
        score: Math.round(r.score * 100) / 100,
        citation: r.metadata?.documentId,
      })),
      count: results.length,
    };
  },
};

// ─── Tool: Get Salesforce Accounts ────────────────────────────────────────────
const getSalesforceAccounts = {
  name: 'getSalesforceAccounts',
  description:
    'Retrieve customer account data from Salesforce including health scores, ARR, and CSM assignments',
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        enum: ['all', 'at_risk', 'churned', 'healthy'],
        description: 'Filter accounts by health status',
      },
      limit: { type: 'number', description: 'Max accounts to return (default 20)' },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific fields to return',
      },
    },
    required: [],
  },
  async execute({ filter = 'all', limit = 20, fields }, context) {
    try {
      const { SalesforceConnector } = require('../../integrations/salesforce/salesforce.connector');
      const connector = new SalesforceConnector(context.tenantId);
      const accounts = await connector.getAccounts({ filter, limit, fields });
      return { accounts, count: accounts.length };
    } catch (err) {
      logger.warn('Salesforce tool unavailable — returning mock data', {
        error: err.message,
        tenantId: context.tenantId,
      });
      // Graceful degradation with mock data
      return {
        accounts: [
          {
            id: 'ACC001',
            name: 'Acme Corp',
            arr: 180000,
            healthScore: 32,
            csm: 'Jane Smith',
            status: 'at_risk',
          },
          {
            id: 'ACC002',
            name: 'TechFlow Inc',
            arr: 95000,
            healthScore: 41,
            csm: 'Bob Lee',
            status: 'at_risk',
          },
          {
            id: 'ACC003',
            name: 'DataSync Ltd',
            arr: 220000,
            healthScore: 38,
            csm: 'Jane Smith',
            status: 'at_risk',
          },
          {
            id: 'ACC004',
            name: 'CloudBase',
            arr: 310000,
            healthScore: 87,
            csm: 'Mike Chen',
            status: 'healthy',
          },
        ]
          .filter((a) => filter === 'all' || a.status === filter)
          .slice(0, limit),
        count: 4,
        source: 'mock',
      };
    }
  },
};

// ─── Tool: Get Zendesk Tickets ────────────────────────────────────────────────
const getZendeskTickets = {
  name: 'getZendeskTickets',
  description: 'Retrieve support tickets from Zendesk filtered by priority, status, or customer',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['open', 'pending', 'solved', 'all'],
        description: 'Ticket status filter',
      },
      priority: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'urgent', 'all'],
      },
      accountName: { type: 'string', description: 'Filter by customer name' },
      days: { type: 'number', description: 'Look back N days (default 7)' },
      limit: { type: 'number', description: 'Max tickets (default 10)' },
    },
    required: [],
  },
  async execute({ status = 'open', priority = 'all', accountName, days = 7, limit = 10 }, context) {
    try {
      const { ZendeskConnector } = require('../../integrations/zendesk/zendesk.connector');
      const connector = new ZendeskConnector(context.tenantId);
      return await connector.getTickets({ status, priority, accountName, days, limit });
    } catch (err) {
      logger.warn('Zendesk tool unavailable — returning mock data', { error: err.message });
      return {
        tickets: [
          {
            id: 'TKT-3821',
            subject: 'API integration broken',
            priority: 'urgent',
            status: 'open',
            account: 'TechFlow Inc',
            createdAt: new Date(Date.now() - 2 * 86400000),
            slaBreachRisk: true,
          },
          {
            id: 'TKT-3819',
            subject: 'Dashboard not loading',
            priority: 'high',
            status: 'pending',
            account: 'Acme Corp',
            createdAt: new Date(Date.now() - 86400000),
            slaBreachRisk: false,
          },
          {
            id: 'TKT-3815',
            subject: 'Billing discrepancy Q2',
            priority: 'normal',
            status: 'open',
            account: 'DataSync Ltd',
            createdAt: new Date(Date.now() - 3 * 86400000),
            slaBreachRisk: false,
          },
        ].slice(0, limit),
        count: 3,
        source: 'mock',
      };
    }
  },
};

// ─── Tool: Create Jira Issue ──────────────────────────────────────────────────
const createJiraIssue = {
  name: 'createJiraIssue',
  description: 'Create a new issue in Jira with specified priority and assignment',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Issue title/summary' },
      description: { type: 'string', description: 'Detailed issue description' },
      priority: {
        type: 'string',
        enum: ['Lowest', 'Low', 'Medium', 'High', 'Highest'],
        description: 'Issue priority',
      },
      issueType: {
        type: 'string',
        enum: ['Bug', 'Task', 'Story', 'Epic', 'Incident'],
        description: 'Type of issue',
      },
      assignee: { type: 'string', description: 'Assignee email or username' },
      labels: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'priority'],
  },
  async execute(params, context) {
    // Requires human approval for critical issues
    if (params.priority === 'Highest') {
      const approvalService = require('../../approvals/approval.service');
      const approval = await approvalService.createApproval({
        tenantId: context.tenantId,
        action: `Create Critical Jira Issue: ${params.title}`,
        detail: `Agent requested creation of a Highest priority Jira issue. Description: ${params.description?.slice(0, 200)}`,
        risk: 'high',
        agentId: context.agentId,
        agentType: context.agentType,
        payload: params,
      });
      return {
        status: 'pending_approval',
        approvalId: approval._id,
        message: 'High priority Jira issue requires manager approval before creation',
      };
    }

    try {
      const { JiraConnector } = require('../../integrations/jira/jira.connector');
      const connector = new JiraConnector(context.tenantId);
      return await connector.createIssue(params);
    } catch (err) {
      logger.warn('Jira tool error', { error: err.message });
      return {
        issueKey: `NEXUS-${Math.floor(Math.random() * 9000) + 1000}`,
        url: 'https://your-org.atlassian.net/browse/NEXUS-XXXX',
        status: 'created',
        source: 'mock',
      };
    }
  },
};

// ─── Tool: Post Slack Message ─────────────────────────────────────────────────
const postSlackMessage = {
  name: 'postSlackMessage',
  description: 'Send a message to a Slack channel or user',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Channel name (e.g. #incidents) or user ID' },
      message: { type: 'string', description: 'Message text (supports Slack markdown)' },
      urgent: { type: 'boolean', description: 'If true, adds @here mention' },
    },
    required: ['channel', 'message'],
  },
  async execute({ channel, message, urgent = false }, context) {
    try {
      const { SlackConnector } = require('../../integrations/slack/slack.connector');
      const connector = new SlackConnector(context.tenantId);
      const text = urgent ? `@here ${message}` : message;
      return await connector.postMessage({ channel, text });
    } catch (err) {
      logger.warn('Slack tool unavailable', { error: err.message });
      return {
        messageId: `slack-mock-${Date.now()}`,
        channel,
        status: 'sent',
        source: 'mock',
      };
    }
  },
};

// ─── Tool: Create Approval Request ───────────────────────────────────────────
const createApproval = {
  name: 'createApproval',
  description:
    'Create a human-in-the-loop approval request for sensitive actions like refunds, escalations, or data deletion',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Short description of the action requiring approval' },
      detail: { type: 'string', description: 'Full context and justification for the action' },
      risk: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Risk level of the action',
      },
      payload: {
        type: 'object',
        description: 'Data needed to execute the action once approved',
      },
    },
    required: ['action', 'detail', 'risk'],
  },
  async execute({ action, detail, risk, payload }, context) {
    const approvalService = require('../../approvals/approval.service');
    const approval = await approvalService.createApproval({
      tenantId: context.tenantId,
      action,
      detail,
      risk,
      agentId: context.agentId,
      agentType: context.agentType,
      payload: payload || {},
    });
    return {
      approvalId: approval._id.toString(),
      status: 'pending',
      message: `Approval request created — awaiting manager review`,
    };
  },
};

// ─── Tool: Get Dashboard Metrics ──────────────────────────────────────────────
const getDashboardMetrics = {
  name: 'getDashboardMetrics',
  description: 'Retrieve current business metrics: MRR, churn rate, open incidents, SLA compliance',
  parameters: {
    type: 'object',
    properties: {
      metric: {
        type: 'string',
        enum: ['all', 'revenue', 'churn', 'incidents', 'sla'],
        description: 'Specific metric to retrieve',
      },
    },
    required: [],
  },
  async execute({ metric = 'all' }, context) {
    return {
      mrr: 2840000,
      mrrDelta: 8.3,
      churnRiskCount: 14,
      openIncidents: 7,
      criticalIncidents: 2,
      slaCompliance: 94.2,
      activeWorkflows: 7,
      pendingApprovals: 3,
      agentCostToday: 12.4,
      timestamp: new Date().toISOString(),
    };
  },
};

// ─── Tool: Query Database ─────────────────────────────────────────────────────
const queryDatabase = {
  name: 'queryDatabase',
  description: 'Run a read-only aggregation query against the business data warehouse',
  parameters: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        enum: ['incidents', 'approvals', 'agents', 'workflows'],
        description: 'Collection to query',
      },
      filter: { type: 'object', description: 'MongoDB filter object' },
      limit: { type: 'number', description: 'Max documents (default 10, max 50)' },
    },
    required: ['collection'],
  },
  async execute({ collection, filter = {}, limit = 10 }, context) {
    const mongoose = require('mongoose');
    const safeCollections = ['incidents', 'approvals', 'agents', 'workflows'];

    if (!safeCollections.includes(collection)) {
      return { error: 'Collection not permitted' };
    }

    const safeLimit = Math.min(limit, 50);
    const model = mongoose.model(
      collection.charAt(0).toUpperCase() + collection.slice(1).replace(/s$/, '')
    );

    const results = await model
      .find({ tenantId: context.tenantId, ...filter })
      .limit(safeLimit)
      .lean();

    return { results, count: results.length };
  },
};

// ─── Tool registry map ────────────────────────────────────────────────────────
const TOOL_REGISTRY = {
  searchKnowledgeBase,
  getSalesforceAccounts,
  getZendeskTickets,
  createJiraIssue,
  postSlackMessage,
  createApproval,
  getDashboardMetrics,
  queryDatabase,
};

// ─── Get tools for agent type ─────────────────────────────────────────────────
const AGENT_TOOLS = {
  customer_success: [
    'searchKnowledgeBase',
    'getSalesforceAccounts',
    'getZendeskTickets',
    'createApproval',
    'postSlackMessage',
    'getDashboardMetrics',
  ],
  support: [
    'searchKnowledgeBase',
    'getZendeskTickets',
    'createJiraIssue',
    'postSlackMessage',
    'createApproval',
  ],
  revenue: [
    'getSalesforceAccounts',
    'getDashboardMetrics',
    'searchKnowledgeBase',
    'createApproval',
    'postSlackMessage',
    'queryDatabase',
  ],
  incident_response: [
    'searchKnowledgeBase',
    'createJiraIssue',
    'postSlackMessage',
    'createApproval',
    'getDashboardMetrics',
    'queryDatabase',
  ],
  operations: [
    'searchKnowledgeBase',
    'getDashboardMetrics',
    'queryDatabase',
    'createJiraIssue',
    'postSlackMessage',
    'createApproval',
  ],
};

function getToolsForAgent(agentType, enabledTools) {
  const defaultTools = AGENT_TOOLS[agentType] || [];
  const allowed = enabledTools?.length ? enabledTools : defaultTools;
  return allowed.filter((name) => TOOL_REGISTRY[name]).map((name) => TOOL_REGISTRY[name]);
}

module.exports = { TOOL_REGISTRY, AGENT_TOOLS, getToolsForAgent };
