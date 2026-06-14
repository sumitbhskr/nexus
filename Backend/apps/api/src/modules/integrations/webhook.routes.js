'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const { triggerByEvent } = require('../workflows/workflow.service');
const { SlackConnector } = require('./slack/slack.connector');
const logger = require('../../common/utils/logger');

// NOTE: Raw body parsing is set up in main.js for /api/v1/webhooks
// All routes here receive req.body as a Buffer

// ─── POST /api/v1/webhooks/slack ──────────────────────────────────────────────
router.post('/slack', async (req, res) => {
  const rawBody = req.body;
  const body = JSON.parse(rawBody.toString());

  // URL verification challenge (Slack setup)
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge });
  }

  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];

  // Verify signature (use any tenant's Slack connector for verification)
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (signingSecret) {
    const sigBaseString = `v0:${timestamp}:${rawBody.toString()}`;
    const mySignature =
      'v0=' +
      crypto
        .createHmac('sha256', signingSecret)
        .update(sigBaseString)
        .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature || ''))) {
      logger.warn('Slack webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event = body.event;
  if (!event) return res.sendStatus(200);

  logger.info('Slack webhook event received', { type: event.type });

  // Map Slack events to internal events
  if (event.type === 'message' && !event.bot_id) {
    // Process user messages — could trigger workflows
    logger.debug('Slack message event', { channel: event.channel, user: event.user });
  }

  res.sendStatus(200);
});

// ─── POST /api/v1/webhooks/zendesk ───────────────────────────────────────────
router.post('/zendesk', async (req, res) => {
  const rawBody = req.body;

  // Verify Zendesk webhook signature
  const signature = req.headers['x-zendesk-webhook-signature'];
  const signingSecret = process.env.ZENDESK_WEBHOOK_SECRET;

  if (signingSecret && signature) {
    const expectedSig = crypto
      .createHmac('sha256', signingSecret)
      .update(rawBody)
      .digest('base64');

    if (signature !== expectedSig) {
      logger.warn('Zendesk webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const payload = JSON.parse(rawBody.toString());
  logger.info('Zendesk webhook received', { type: payload.type });

  // Map Zendesk events to NEXUS internal events
  const eventMap = {
    'ticket.created': 'TICKET_CREATED',
    'ticket.updated': 'TICKET_UPDATED',
    'ticket.requester_responded': 'TICKET_UPDATED',
  };

  const internalEventType = eventMap[payload.type];

  if (internalEventType && payload.account_id) {
    // Attempt to trigger matching workflows
    // In production: look up tenantId from Zendesk account_id
    logger.info('Zendesk event mapped to internal event', {
      zendesk: payload.type,
      internal: internalEventType,
    });
  }

  res.sendStatus(200);
});

// ─── POST /api/v1/webhooks/jira ───────────────────────────────────────────────
router.post('/jira', async (req, res) => {
  const payload = JSON.parse(req.body.toString());

  logger.info('Jira webhook received', {
    event: payload.webhookEvent,
    issueKey: payload.issue?.key,
  });

  // Jira events → internal events
  if (payload.webhookEvent === 'jira:issue_updated') {
    const priority = payload.issue?.fields?.priority?.name;
    if (priority === 'Highest' || priority === 'High') {
      logger.info('High priority Jira issue update received', {
        issueKey: payload.issue?.key,
      });
    }
  }

  res.sendStatus(200);
});

// ─── POST /api/v1/webhooks/github ─────────────────────────────────────────────
// Example: trigger incident workflow on CI failure
router.post('/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = JSON.parse(req.body.toString());

  logger.info('GitHub webhook received', { event, action: payload.action });

  if (event === 'workflow_run' && payload.workflow_run?.conclusion === 'failure') {
    logger.info('GitHub CI failure detected — incident workflow may trigger', {
      workflow: payload.workflow_run.name,
      branch: payload.workflow_run.head_branch,
    });
  }

  res.sendStatus(200);
});

module.exports = router;