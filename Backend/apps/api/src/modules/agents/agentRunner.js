'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { Agent } = require('./agent.model');
const { getToolsForAgent } = require('./tools/index');
const { emitAgentUpdate } = require('../../config/socket');
const logger = require('../../common/utils/logger');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Cost per token (claude-sonnet-4-6 pricing) ──────────────────────────────
const COST_PER_INPUT_TOKEN = 0.000003;
const COST_PER_OUTPUT_TOKEN = 0.000015;
const MAX_ITERATIONS = 10;

// ─── Agent system prompts by type ────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  customer_success: `You are the Customer Success Agent for NEXUS, an enterprise operational intelligence platform.
Your mission: Proactively identify at-risk customers, surface escalation signals, and recommend actions to improve customer health.
You have access to Salesforce account data, Zendesk tickets, and the internal knowledge base.
Always cite data sources. Recommend specific, actionable next steps. Flag customers requiring executive escalation.
When a sensitive action is required (refund, escalation to exec), always create an approval request first.`,

  support: `You are the Support Agent for NEXUS.
Your mission: Triage open support tickets, identify SLA breach risks, surface recurring issue patterns, and create Jira issues for engineering when needed.
Prioritize urgent and high-priority tickets. Identify customers with multiple open tickets as escalation candidates.
Always search the knowledge base for known solutions before escalating to engineering.`,

  revenue: `You are the Revenue Agent for NEXUS.
Your mission: Monitor MRR trends, identify pipeline gaps, flag revenue risks, and surface expansion opportunities.
Analyze Salesforce data for deal progression, churn signals, and upsell candidates.
Provide data-driven recommendations with specific dollar impact estimates.`,

  incident_response: `You are the Incident Response Agent for NEXUS.
Your mission: Detect, triage, and coordinate response to production incidents.
Create Jira issues for all critical incidents. Notify relevant Slack channels. Escalate unresolved critical incidents.
Follow the incident severity matrix: P1 (critical, >$10K/hr impact), P2 (high), P3 (medium), P4 (low).
Always recommend a post-mortem for P1/P2 incidents.`,

  operations: `You are the Operations Agent for NEXUS.
Your mission: Monitor workflow health, system performance, integration status, and operational metrics.
Identify bottlenecks, automation savings opportunities, and process improvements.
Surface SLA violations, failed workflow executions, and agent errors.`,
};

// ─── Build Anthropic tool definitions from tool registry ──────────────────────
function buildAnthropicTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

// ─── Execute a single agent task ──────────────────────────────────────────────
async function runAgentTask({ agentId, task, tenantId }) {
  const agent = await Agent.findOne({ _id: agentId, tenantId, isActive: true });

  if (!agent) {
    throw new Error(`Agent ${agentId} not found or inactive`);
  }

  // Circuit breaker check
  if (agent.isCircuitOpen()) {
    throw new Error(
      `Agent circuit breaker is OPEN — too many recent failures. Auto-reset in ${agent.circuitBreaker.resetAfterMs / 1000}s`
    );
  }

  const taskId = uuidv4();

  // Update agent status
  agent.status = 'running';
  agent.currentTask = task;
  agent.currentTaskId = taskId;
  agent.totalExecutions += 1;

  const execution = {
    taskId,
    task,
    status: 'running',
    steps: [],
    tokensUsed: 0,
    costUSD: 0,
    startedAt: new Date(),
  };

  agent.executions.push(execution);
  await agent.save();

  // Emit real-time status
  emitAgentUpdate(tenantId, {
    agentId,
    status: 'running',
    currentTask: task,
    taskId,
  });

  const executionRef = agent.executions[agent.executions.length - 1];
  const context = {
    tenantId,
    agentId: agent._id.toString(),
    agentType: agent.type,
    taskId,
  };

  const tools = getToolsForAgent(agent.type, agent.config.enabledTools);
  const anthropicTools = buildAnthropicTools(tools);
  const systemPrompt =
    agent.config.systemPromptOverride || SYSTEM_PROMPTS[agent.type] || SYSTEM_PROMPTS.operations;

  const messages = [{ role: 'user', content: task }];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iteration = 0;
  let finalResult = null;

  const startTime = Date.now();

  try {
    // ─── Agentic loop ────────────────────────────────────────
    while (iteration < MAX_ITERATIONS) {
      iteration++;

      logger.debug('Agent iteration', {
        agentId,
        taskId,
        iteration,
        messageCount: messages.length,
      });

      const response = await anthropic.messages.create({
        model: agent.config.model || 'claude-sonnet-4-6',
        max_tokens: agent.config.maxTokensPerExecution || 2000,
        system: systemPrompt,
        tools: anthropicTools,
        messages,
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Record step
      const stepData = {
        step: `iteration_${iteration}`,
        action: response.stop_reason,
        result: {
          stopReason: response.stop_reason,
          contentBlocks: response.content.length,
        },
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        timestamp: new Date(),
      };
      executionRef.steps.push(stepData);

      // ─── Terminal: end_turn — agent has final answer ──────
      if (response.stop_reason === 'end_turn') {
        const textContent = response.content.find((b) => b.type === 'text');
        finalResult = textContent?.text || 'Task completed';

        logger.info('Agent task completed', {
          agentId,
          taskId,
          iterations: iteration,
          totalTokens: totalInputTokens + totalOutputTokens,
        });
        break;
      }

      // ─── Tool use: execute all tool calls in parallel ─────
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');

        // Add assistant message with tool calls
        messages.push({ role: 'assistant', content: response.content });

        // Execute tools in parallel
        const toolResults = await Promise.allSettled(
          toolUseBlocks.map(async (toolUse) => {
            const tool = tools.find((t) => t.name === toolUse.name);

            if (!tool) {
              return {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({ error: `Tool '${toolUse.name}' not found` }),
                is_error: true,
              };
            }

            logger.debug('Agent executing tool', {
              agentId,
              tool: toolUse.name,
              input: toolUse.input,
            });

            try {
              const result = await Promise.race([
                tool.execute(toolUse.input, context),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Tool timeout after 30s')), 30000)
                ),
              ]);

              logger.debug('Tool executed successfully', {
                agentId,
                tool: toolUse.name,
                resultKeys: Object.keys(result || {}),
              });

              return {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(result),
              };
            } catch (toolErr) {
              logger.warn('Tool execution failed', {
                agentId,
                tool: toolUse.name,
                error: toolErr.message,
              });

              return {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({ error: toolErr.message }),
                is_error: true,
              };
            }
          })
        );

        const toolResultContent = toolResults.map((r) =>
          r.status === 'fulfilled'
            ? r.value
            : {
                type: 'tool_result',
                tool_use_id: 'unknown',
                content: JSON.stringify({ error: r.reason?.message }),
                is_error: true,
              }
        );

        messages.push({ role: 'user', content: toolResultContent });
        continue;
      }

      // Unknown stop reason — break
      logger.warn('Unknown stop reason from agent', {
        agentId,
        stopReason: response.stop_reason,
      });
      finalResult = 'Task ended with unknown stop reason';
      break;
    }

    if (iteration >= MAX_ITERATIONS && !finalResult) {
      finalResult = `Task reached maximum iteration limit (${MAX_ITERATIONS}) — partial completion`;
      logger.warn('Agent hit max iterations', { agentId, taskId });
    }

    // ─── Calculate cost ────────────────────────────────────
    const costUSD =
      totalInputTokens * COST_PER_INPUT_TOKEN + totalOutputTokens * COST_PER_OUTPUT_TOKEN;

    const durationMs = Date.now() - startTime;

    // ─── Update execution record ───────────────────────────
    executionRef.status = 'completed';
    executionRef.result = finalResult;
    executionRef.tokensUsed = totalInputTokens + totalOutputTokens;
    executionRef.costUSD = Math.round(costUSD * 10000) / 10000;
    executionRef.completedAt = new Date();
    executionRef.durationMs = durationMs;

    // Update agent totals
    agent.totalCostUSD = Math.round((agent.totalCostUSD + costUSD) * 10000) / 10000;
    agent.totalTokensUsed += totalInputTokens + totalOutputTokens;

    await agent.recordSuccess();

    emitAgentUpdate(tenantId, {
      agentId,
      status: 'idle',
      taskId,
      result: finalResult,
      costUSD: executionRef.costUSD,
      durationMs,
    });

    return {
      taskId,
      result: finalResult,
      tokensUsed: totalInputTokens + totalOutputTokens,
      costUSD: executionRef.costUSD,
      durationMs,
      iterations: iteration,
    };
  } catch (err) {
    logger.error('Agent task failed', {
      agentId,
      taskId,
      error: err.message,
      stack: err.stack,
    });

    // Update execution as failed
    executionRef.status = 'failed';
    executionRef.error = err.message;
    executionRef.completedAt = new Date();
    executionRef.durationMs = Date.now() - startTime;

    await agent.recordFailure();

    emitAgentUpdate(tenantId, {
      agentId,
      status: 'error',
      taskId,
      error: err.message,
    });

    throw err;
  }
}

module.exports = { runAgentTask };
