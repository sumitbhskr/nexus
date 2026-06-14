'use strict';

const { getRedisClient, KEYS } = require('../../config/redis');
const { triggerByEvent } = require('../workflows/workflow.service');
const logger = require('../../common/utils/logger');

// ─── Event types ──────────────────────────────────────────────────────────────
const EVENT_TYPES = {
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_UPDATED: 'TICKET_UPDATED',
  TICKET_ESCALATED: 'TICKET_ESCALATED',
  CHURN_RISK_DETECTED: 'CHURN_RISK_DETECTED',
  REVENUE_DROP_DETECTED: 'REVENUE_DROP_DETECTED',
  CRITICAL_INCIDENT_OPENED: 'CRITICAL_INCIDENT_OPENED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  SLA_BREACH_RISK: 'SLA_BREACH_RISK',
  APPROVAL_APPROVED: 'APPROVAL_APPROVED',
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  AGENT_TASK_COMPLETED: 'AGENT_TASK_COMPLETED',
};

// ─── Stream names ─────────────────────────────────────────────────────────────
const STREAM_KEY = 'nexus:events:global';
const CONSUMER_GROUP = 'nexus-workers';
const CONSUMER_NAME = `worker-${process.pid}`;

let isConsuming = false;

// ─── Publish event to Redis Stream ───────────────────────────────────────────
async function publishEvent(tenantId, eventType, payload = {}) {
  const redis = getRedisClient();

  if (!redis) {
    logger.warn('EventBus: Redis not available — event not published', { eventType });
    return;
  }

  if (!EVENT_TYPES[eventType]) {
    logger.warn('EventBus: Unknown event type', { eventType });
  }

  const message = {
    tenantId: tenantId.toString(),
    eventType,
    payload: JSON.stringify(payload),
    publishedAt: Date.now().toString(),
  };

  try {
    const messageId = await redis.xadd(STREAM_KEY, '*', ...Object.entries(message).flat());

    logger.info('Event published', {
      eventType,
      messageId,
      tenantId,
    });

    return messageId;
  } catch (err) {
    logger.error('Failed to publish event', {
      eventType,
      error: err.message,
    });
  }
}

// ─── Start event consumer ─────────────────────────────────────────────────────
async function startEventConsumer() {
  const redis = getRedisClient();

  if (!redis) {
    logger.warn('EventBus: Redis not available — consumer not started');
    return;
  }

  // Create consumer group if it doesn't exist
  try {
    await redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '$', 'MKSTREAM');
    logger.info('EventBus: Consumer group created', { group: CONSUMER_GROUP });
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      logger.warn('EventBus: Consumer group may already exist', { error: err.message });
    }
  }

  isConsuming = true;
  logger.info('EventBus: Consumer started', { consumer: CONSUMER_NAME });

  consumeLoop(redis);

  // Process pending (unacknowledged) messages on startup
  processPendingMessages(redis);
}

// ─── Main consume loop ────────────────────────────────────────────────────────
async function consumeLoop(redis) {
  while (isConsuming) {
    try {
      // Block for up to 2 seconds waiting for new messages
      const results = await redis.xreadgroup(
        'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
        'COUNT', '10',
        'BLOCK', '2000',
        'STREAMS', STREAM_KEY, '>'
      );

      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          await processMessage(redis, messageId, fields);
        }
      }
    } catch (err) {
      if (isConsuming) {
        logger.error('EventBus: Consumer loop error', { error: err.message });
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

// ─── Process a single message ─────────────────────────────────────────────────
async function processMessage(redis, messageId, fields) {
  // Parse fields array [key, val, key, val, ...]
  const message = {};
  for (let i = 0; i < fields.length; i += 2) {
    message[fields[i]] = fields[i + 1];
  }

  const { tenantId, eventType, payload: payloadStr } = message;

  let payload = {};
  try {
    payload = JSON.parse(payloadStr || '{}');
  } catch {
    payload = {};
  }

  logger.debug('EventBus: Processing message', { messageId, eventType, tenantId });

  try {
    // ─── Dispatch to workflow engine ────────────────────────
    await triggerByEvent(tenantId, eventType, payload);

    // ─── Internal event handlers ────────────────────────────
    await handleInternalEvent(tenantId, eventType, payload);

    // Acknowledge message
    await redis.xack(STREAM_KEY, CONSUMER_GROUP, messageId);

    logger.debug('EventBus: Message processed and acknowledged', { messageId, eventType });
  } catch (err) {
    logger.error('EventBus: Message processing failed', {
      messageId,
      eventType,
      error: err.message,
    });
    // Don't ack — will be redelivered via pending messages
  }
}

// ─── Internal event handlers ──────────────────────────────────────────────────
async function handleInternalEvent(tenantId, eventType, payload) {
  const { emitToTenant } = require('../../config/socket');

  switch (eventType) {
    case EVENT_TYPES.CHURN_RISK_DETECTED:
      emitToTenant(tenantId, 'alert:churn_risk', payload);
      break;

    case EVENT_TYPES.CRITICAL_INCIDENT_OPENED:
      emitToTenant(tenantId, 'alert:critical_incident', payload);
      break;

    case EVENT_TYPES.SLA_BREACH_RISK:
      emitToTenant(tenantId, 'alert:sla_breach', payload);
      break;

    case EVENT_TYPES.APPROVAL_APPROVED:
    case EVENT_TYPES.APPROVAL_REJECTED: {
      const { resumeWorkflowAfterApproval } = require('../workflows/workflowEngine');
      if (payload.workflowId && payload.executionId) {
        await resumeWorkflowAfterApproval(
          payload.workflowId,
          payload.executionId,
          eventType === EVENT_TYPES.APPROVAL_APPROVED
        );
      }
      break;
    }

    default:
      break;
  }
}

// ─── Process pending messages on startup ──────────────────────────────────────
async function processPendingMessages(redis) {
  try {
    const pending = await redis.xpending(
      STREAM_KEY,
      CONSUMER_GROUP,
      '-', '+',
      '100'
    );

    if (!pending || pending.length === 0) return;

    logger.info(`EventBus: Processing ${pending.length} pending messages`);

    for (const [messageId] of pending) {
      const results = await redis.xrange(STREAM_KEY, messageId, messageId);
      if (results && results.length > 0) {
        const [, fields] = results[0];
        await processMessage(redis, messageId, fields);
      }
    }
  } catch (err) {
    logger.warn('EventBus: Error processing pending messages', { error: err.message });
  }
}

// ─── Stop consumer ────────────────────────────────────────────────────────────
function stopEventConsumer() {
  isConsuming = false;
  logger.info('EventBus: Consumer stopped');
}

// ─── Trim old events (run periodically) ──────────────────────────────────────
async function trimEventStream(maxLen = 10000) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.xtrim(STREAM_KEY, 'MAXLEN', '~', maxLen);
    logger.debug('EventBus: Stream trimmed', { maxLen });
  } catch (err) {
    logger.warn('EventBus: Trim failed', { error: err.message });
  }
}

module.exports = {
  publishEvent,
  startEventConsumer,
  stopEventConsumer,
  trimEventStream,
  EVENT_TYPES,
};