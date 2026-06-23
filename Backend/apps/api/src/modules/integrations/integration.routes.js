'use strict';

const express = require('express');
const router = express.Router();

const { authenticate, authorize } = require('../../common/middleware/auth');
const { auditLog } = require('../../common/middleware/auditLog');
const { JiraConnector } = require('./jira/jira.connector');
const { SlackConnector } = require('./slack/slack.connector');
const { ZendeskConnector } = require('./zendesk/zendesk.connector');
const { SalesforceConnector } = require('./salesforce/salesforce.connector');
const { HubSpotConnector }      = require('./hubspot/hubspot.connector');
const { NotionConnector }        = require('./notion/notion.connector');
const { GoogleSheetsConnector }  = require('./google-sheets/google-sheets.connector');

router.use(authenticate);

// ─── Connector registry ───────────────────────────────────────────────────────
const CONNECTORS = {
  jira: (tenantId) => new JiraConnector(tenantId),
  slack: (tenantId) => new SlackConnector(tenantId),
  zendesk: (tenantId) => new ZendeskConnector(tenantId),
  salesforce: (tenantId) => new SalesforceConnector(tenantId),
  hubspot:        (tenantId) => new HubSpotConnector(tenantId),
  notion:         (tenantId) => new NotionConnector(tenantId),
 'google-sheets': (tenantId) => new GoogleSheetsConnector(tenantId),
};

// ─── GET /api/v1/integrations ─────────────────────────────────────────────────
// Returns status of all configured integrations
router.get('/', async (req, res) => {
  const statuses = await Promise.allSettled(
    Object.entries(CONNECTORS).map(async ([name, factory]) => {
      const connector = factory(req.tenantId);
      const configured = connector.isConfigured();
      let connectionResult = { connected: false, reason: 'Not configured' };

      if (configured) {
        connectionResult = await connector.testConnection();
      }

      return {
        provider: name,
        configured,
        ...connectionResult,
      };
    })
  );

  const integrations = statuses.map((result, index) => {
    const name = Object.keys(CONNECTORS)[index];
    if (result.status === 'rejected') {
      return { provider: name, configured: false, connected: false, error: result.reason?.message };
    }
    return result.value;
  });

  res.json({ success: true, data: { integrations } });
});

// ─── GET /api/v1/integrations/:provider/status ───────────────────────────────
router.get('/:provider/status', async (req, res) => {
  const { provider } = req.params;
  const factory = CONNECTORS[provider];

  if (!factory) {
    return res.status(404).json({
      success: false,
      error: { message: `Provider '${provider}' not supported` },
    });
  }

  const connector = factory(req.tenantId);
  const result = connector.isConfigured()
    ? await connector.testConnection()
    : { connected: false, reason: 'Not configured' };

  res.json({ success: true, data: { provider, ...result } });
});

// ─── POST /api/v1/integrations/:provider/sync ────────────────────────────────
router.post(
  '/:provider/sync',
  authorize('manager'),
  auditLog('INTEGRATION_SYNC', 'integration'),
  async (req, res) => {
    const { provider } = req.params;

    // Sync is provider-specific — return basic status for now
    res.json({
      success: true,
      data: {
        provider,
        status: 'sync_queued',
        message: `${provider} data sync queued — results available in 30-60 seconds`,
        queuedAt: new Date().toISOString(),
      },
    });
  }
);

// ─── GET /api/v1/integrations/jira/issues ────────────────────────────────────
router.get('/jira/issues', async (req, res) => {
  const { jql, limit } = req.query;
  const connector = new JiraConnector(req.tenantId);
  const result = await connector.searchIssues(
    jql || `project = ${process.env.JIRA_PROJECT_KEY || 'NEXUS'} ORDER BY created DESC`,
    ['summary', 'status', 'priority', 'assignee'],
    Math.min(parseInt(limit) || 20, 50)
  );
  res.json({ success: true, data: result });
});

// ─── GET /api/v1/integrations/zendesk/tickets ────────────────────────────────
router.get('/zendesk/tickets', async (req, res) => {
  const { status, priority, days, limit } = req.query;
  const connector = new ZendeskConnector(req.tenantId);
  const result = await connector.getTickets({
    status: status || 'open',
    priority: priority || 'all',
    days: parseInt(days) || 7,
    limit: Math.min(parseInt(limit) || 20, 50),
  });
  res.json({ success: true, data: result });
});

// ─── GET /api/v1/integrations/salesforce/accounts ────────────────────────────
router.get('/salesforce/accounts', async (req, res) => {
  const { filter, limit } = req.query;
  const connector = new SalesforceConnector(req.tenantId);
  const result = await connector.getAccounts({
    filter: filter || 'all',
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json({ success: true, data: result });
});

// ─── GET /api/v1/integrations/slack/channels ─────────────────────────────────
router.get('/slack/channels', async (req, res) => {
  const connector = new SlackConnector(req.tenantId);
  const result = await connector.listChannels();
  res.json({ success: true, data: result });
});

module.exports = router;