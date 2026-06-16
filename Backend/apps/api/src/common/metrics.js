// src/common/metrics.js
'use strict';
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'nexus_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register],
});

const agentExecutionDuration = new client.Histogram({
  name: 'nexus_agent_execution_duration_ms',
  help: 'Agent task execution duration in milliseconds',
  labelNames: ['agent_type', 'status'],
  buckets: [500, 1000, 5000, 10000, 30000, 60000, 120000],
  registers: [register],
});

const agentCostUSD = new client.Counter({
  name: 'nexus_agent_cost_usd_total',
  help: 'Total USD cost of agent LLM calls',
  labelNames: ['agent_type'],
  registers: [register],
});

const workflowExecutions = new client.Counter({
  name: 'nexus_workflow_executions_total',
  help: 'Total workflow executions',
  labelNames: ['trigger_type', 'status'],
  registers: [register],
});

const activeAgents = new client.Gauge({
  name: 'nexus_active_agents',
  help: 'Number of currently running agents',
  labelNames: ['tenant_id'],
  registers: [register],
});

const pendingApprovals = new client.Gauge({
  name: 'nexus_pending_approvals',
  help: 'Number of pending approval requests',
  labelNames: ['tenant_id', 'risk'],
  registers: [register],
});

const eventBusLag = new client.Gauge({
  name: 'nexus_event_bus_lag',
  help: 'Number of unprocessed events in the stream',
  registers: [register],
});

module.exports = {
  register,
  httpRequestDuration,
  agentExecutionDuration,
  agentCostUSD,
  workflowExecutions,
  activeAgents,
  pendingApprovals,
  eventBusLag,
};
