'use strict';

const { BaseConnector } = require('../connector.base');
const logger = require('../../../common/utils/logger');

class ZendeskConnector extends BaseConnector {
  constructor(tenantId) {
    super(tenantId, 'Zendesk');

    const subdomain = process.env.ZENDESK_SUBDOMAIN;
    const email = process.env.ZENDESK_EMAIL;
    const token = process.env.ZENDESK_API_TOKEN;

    if (!subdomain || !email || !token) {
      this._configured = false;
      return;
    }

    this._configured = true;
    this.subdomain = subdomain;

    const auth = Buffer.from(`${email}/token:${token}`).toString('base64');

    this.client = this.buildAxiosClient(
      `https://${subdomain}.zendesk.com/api/v2`,
      { Authorization: `Basic ${auth}` }
    );
  }

  isConfigured() {
    return this._configured;
  }

  async testConnection() {
    if (!this.isConfigured()) return { connected: false, reason: 'Not configured' };

    try {
      const res = await this.withRetry(() => this.client.get('/users/me.json'));
      return {
        connected: true,
        agent: res.data.user?.name,
        email: res.data.user?.email,
      };
    } catch (err) {
      return { connected: false, reason: err.message };
    }
  }

  // ─── Get tickets ──────────────────────────────────────────────
  async getTickets({ status = 'open', priority = 'all', accountName, days = 7, limit = 20 }) {
    if (!this.isConfigured()) {
      return this._mockTickets(status, priority, limit);
    }

    const since = new Date(Date.now() - days * 86400000).toISOString();
    let query = `type:ticket created>${since}`;

    if (status !== 'all') query += ` status:${status}`;
    if (priority !== 'all') query += ` priority:${priority}`;
    if (accountName) query += ` organization:"${accountName}"`;

    const res = await this.withRetry(() =>
      this.client.get('/search.json', {
        params: { query, sort_by: 'created_at', sort_order: 'desc', per_page: limit },
      })
    );

    const tickets = (res.data.results || []).map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      requesterName: t.via?.source?.from?.name,
      assigneeName: t.assignee_id ? String(t.assignee_id) : null,
      tags: t.tags,
      slaBreachRisk: this._isSLAAtRisk(t),
    }));

    return { tickets, count: tickets.length, total: res.data.count };
  }

  // ─── Get single ticket ────────────────────────────────────────
  async getTicket(ticketId) {
    if (!this.isConfigured()) {
      return { id: ticketId, subject: 'Mock ticket', status: 'open', source: 'mock' };
    }

    const res = await this.withRetry(() =>
      this.client.get(`/tickets/${ticketId}.json`)
    );

    return res.data.ticket;
  }

  // ─── Update ticket ────────────────────────────────────────────
  async updateTicket(ticketId, updates = {}) {
    if (!this.isConfigured()) {
      return { id: ticketId, status: 'updated', source: 'mock' };
    }

    const ticket = {};
    if (updates.status) ticket.status = updates.status;
    if (updates.priority) ticket.priority = updates.priority;
    if (updates.tags) ticket.tags = updates.tags;
    if (updates.assigneeId) ticket.assignee_id = updates.assigneeId;

    const res = await this.withRetry(() =>
      this.client.put(`/tickets/${ticketId}.json`, { ticket })
    );

    logger.info('Zendesk ticket updated', {
      ticketId,
      updates,
      tenantId: this.tenantId,
    });

    return res.data.ticket;
  }

  // ─── Add public comment ───────────────────────────────────────
  async addComment(ticketId, comment, isPublic = true) {
    if (!this.isConfigured()) {
      return { ticketId, status: 'comment_added', source: 'mock' };
    }

    await this.withRetry(() =>
      this.client.put(`/tickets/${ticketId}.json`, {
        ticket: {
          comment: { body: comment, public: isPublic },
        },
      })
    );

    return { ticketId, status: 'comment_added' };
  }

  // ─── Create ticket ────────────────────────────────────────────
  async createTicket({ subject, description, priority = 'normal', requesterEmail, tags = [] }) {
    if (!this.isConfigured()) {
      return { id: `mock-${Date.now()}`, subject, status: 'new', source: 'mock' };
    }

    const res = await this.withRetry(() =>
      this.client.post('/tickets.json', {
        ticket: {
          subject,
          comment: { body: description },
          priority,
          requester: { email: requesterEmail },
          tags: ['nexus-agent', ...tags],
        },
      })
    );

    return res.data.ticket;
  }

  // ─── Get SLA violations ───────────────────────────────────────
  async getSLAViolations() {
    if (!this.isConfigured()) {
      return { violations: [], count: 0, source: 'mock' };
    }

    try {
      const res = await this.withRetry(() =>
        this.client.get('/slas/policies.json')
      );
      return { policies: res.data.sla_policies, count: res.data.sla_policies?.length || 0 };
    } catch {
      return { violations: [], count: 0 };
    }
  }

  // ─── SLA risk heuristic ───────────────────────────────────────
  _isSLAAtRisk(ticket) {
    if (!ticket.created_at) return false;
    const ageHours = (Date.now() - new Date(ticket.created_at)) / 3600000;

    const slaLimits = { urgent: 4, high: 8, normal: 24, low: 72 };
    const limit = slaLimits[ticket.priority] || 24;

    return ageHours > limit * 0.8;
  }

  // ─── Mock data ────────────────────────────────────────────────
  _mockTickets(status, priority, limit) {
    return {
      tickets: [
        {
          id: 3821,
          subject: 'API integration completely broken after update',
          status: 'open',
          priority: 'urgent',
          createdAt: new Date(Date.now() - 49 * 3600000).toISOString(),
          account: 'TechFlow Inc',
          slaBreachRisk: true,
        },
        {
          id: 3819,
          subject: 'Dashboard charts not loading in Firefox',
          status: 'pending',
          priority: 'high',
          createdAt: new Date(Date.now() - 20 * 3600000).toISOString(),
          account: 'Acme Corp',
          slaBreachRisk: false,
        },
        {
          id: 3815,
          subject: 'Billing discrepancy on May invoice',
          status: 'open',
          priority: 'normal',
          createdAt: new Date(Date.now() - 72 * 3600000).toISOString(),
          account: 'DataSync Ltd',
          slaBreachRisk: true,
        },
      ].slice(0, limit),
      count: 3,
      source: 'mock',
    };
  }
}

module.exports = { ZendeskConnector };