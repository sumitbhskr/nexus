'use strict';

const { BaseConnector } = require('../connector.base');
const logger = require('../../../common/utils/logger');

// ─── Environment-driven config ────────────────────────────────────────────────
// HubSpot uses a long-lived Private App token (no OAuth refresh needed for
// server-to-server integrations). Store in HUBSPOT_ACCESS_TOKEN env var.
// Docs: https://developers.hubspot.com/docs/api/private-apps

const HUBSPOT_BASE_URL = 'https://api.hubapi.com';
const DEFAULT_CONTACT_PROPS = ['firstname', 'lastname', 'email', 'phone', 'company'];
const DEFAULT_DEAL_PROPS = ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline'];
const MAX_PAGE_SIZE = 100; // HubSpot hard limit per request

class HubSpotConnector extends BaseConnector {
  constructor(tenantId) {
    super(tenantId, 'HubSpot');

    const token = process.env.HUBSPOT_ACCESS_TOKEN;

    if (token) {
      this.client = this.buildAxiosClient(HUBSPOT_BASE_URL, { Authorization: `Bearer ${token}` });
    }
  }

  // ─── isConfigured ──────────────────────────────────────────────────────────
  isConfigured() {
    return Boolean(process.env.HUBSPOT_ACCESS_TOKEN);
  }

  // ─── testConnection ────────────────────────────────────────────────────────
  // Calls /crm/v3/objects/contacts with limit=1 — cheap read, confirms auth
  async testConnection() {
    if (!this.isConfigured()) {
      return { connected: false, reason: 'HUBSPOT_ACCESS_TOKEN not set' };
    }

    try {
      await this.withRetry(() =>
        this.client.get('/crm/v3/objects/contacts', { params: { limit: 1 } })
      );

      logger.info('HubSpot connection verified', { tenantId: this.tenantId });
      return { connected: true };
    } catch (err) {
      const status = err.response?.status;
      const reason =
        status === 401
          ? 'Invalid or expired access token'
          : status === 403
            ? 'Token lacks required scopes (crm.objects.contacts.read)'
            : err.message;

      logger.warn('HubSpot connection test failed', {
        tenantId: this.tenantId,
        status,
        reason,
      });

      return { connected: false, reason };
    }
  }

  // ─── getContacts ───────────────────────────────────────────────────────────
  // Returns paginated contacts. `after` is the cursor token for the next page.
  // Think of cursor pagination like a bookmark — you pass back the last page's
  // bookmark to get the next chunk, instead of using a page number.
  async getContacts({ limit = 20, after, properties = DEFAULT_CONTACT_PROPS } = {}) {
    this._assertConfigured();

    const params = {
      limit: Math.min(limit, MAX_PAGE_SIZE),
      properties: properties.join(','),
    };
    if (after) params.after = after;

    const response = await this.withRetry(() =>
      this.client.get('/crm/v3/objects/contacts', { params })
    );

    return {
      contacts: response.data.results.map(this._normalizeContact),
      paging: response.data.paging ?? null,
    };
  }

  // ─── searchContacts ────────────────────────────────────────────────────────
  // Filter contacts using HubSpot's filter API.
  // filterGroups example: [{ filters: [{ propertyName:'email', operator:'EQ', value:'x@y.com' }] }]
  async searchContacts({
    filterGroups,
    properties = DEFAULT_CONTACT_PROPS,
    limit = 20,
    after,
  } = {}) {
    this._assertConfigured();

    if (!filterGroups || !Array.isArray(filterGroups) || filterGroups.length === 0) {
      throw Object.assign(new Error('filterGroups is required and must be a non-empty array'), {
        status: 400,
      });
    }

    const body = {
      filterGroups,
      properties,
      limit: Math.min(limit, MAX_PAGE_SIZE),
    };
    if (after) body.after = after;

    const response = await this.withRetry(() =>
      this.client.post('/crm/v3/objects/contacts/search', body)
    );

    return {
      contacts: response.data.results.map(this._normalizeContact),
      total: response.data.total,
      paging: response.data.paging ?? null,
    };
  }

  // ─── createContact ─────────────────────────────────────────────────────────
  async createContact({ email, firstname, lastname, phone, company, additionalProps = {} }) {
    this._assertConfigured();

    if (!email) {
      throw Object.assign(new Error('email is required to create a HubSpot contact'), {
        status: 400,
      });
    }

    const properties = {
      email,
      ...(firstname && { firstname }),
      ...(lastname && { lastname }),
      ...(phone && { phone }),
      ...(company && { company }),
      ...additionalProps,
    };

    const response = await this.withRetry(() =>
      this.client.post('/crm/v3/objects/contacts', { properties })
    );

    logger.info('HubSpot contact created', {
      tenantId: this.tenantId,
      contactId: response.data.id,
    });

    return this._normalizeContact(response.data);
  }

  // ─── updateContact ─────────────────────────────────────────────────────────
  async updateContact(contactId, properties = {}) {
    this._assertConfigured();

    if (!contactId) {
      throw Object.assign(new Error('contactId is required'), { status: 400 });
    }
    if (!properties || Object.keys(properties).length === 0) {
      throw Object.assign(new Error('At least one property is required for update'), {
        status: 400,
      });
    }

    const response = await this.withRetry(() =>
      this.client.patch(`/crm/v3/objects/contacts/${contactId}`, { properties })
    );

    logger.info('HubSpot contact updated', { tenantId: this.tenantId, contactId });

    return this._normalizeContact(response.data);
  }

  // ─── createDeal ────────────────────────────────────────────────────────────
  // dealstage must match your HubSpot pipeline's stage IDs.
  // pipeline defaults to 'default' (the built-in sales pipeline).
  async createDeal({
    dealname,
    amount,
    dealstage,
    closedate,
    pipeline = 'default',
    additionalProps = {},
  }) {
    this._assertConfigured();

    if (!dealname) {
      throw Object.assign(new Error('dealname is required to create a HubSpot deal'), {
        status: 400,
      });
    }
    if (!dealstage) {
      throw Object.assign(
        new Error('dealstage is required (must match a valid stage ID in your pipeline)'),
        { status: 400 }
      );
    }

    const properties = {
      dealname,
      dealstage,
      pipeline,
      ...(amount !== undefined && { amount: String(amount) }),
      ...(closedate && { closedate }),
      ...additionalProps,
    };

    const response = await this.withRetry(() =>
      this.client.post('/crm/v3/objects/deals', { properties })
    );

    logger.info('HubSpot deal created', {
      tenantId: this.tenantId,
      dealId: response.data.id,
      dealname,
    });

    return this._normalizeDeal(response.data);
  }

  // ─── getDeals ──────────────────────────────────────────────────────────────
  async getDeals({ limit = 20, after, properties = DEFAULT_DEAL_PROPS } = {}) {
    this._assertConfigured();

    const params = {
      limit: Math.min(limit, MAX_PAGE_SIZE),
      properties: properties.join(','),
    };
    if (after) params.after = after;

    const response = await this.withRetry(() =>
      this.client.get('/crm/v3/objects/deals', { params })
    );

    return {
      deals: response.data.results.map(this._normalizeDeal),
      paging: response.data.paging ?? null,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  _assertConfigured() {
    if (!this.isConfigured() || !this.client) {
      throw Object.assign(
        new Error('HubSpot integration is not configured. Set HUBSPOT_ACCESS_TOKEN.'),
        { status: 503 }
      );
    }
  }

  _normalizeContact(raw) {
    return {
      id: raw.id,
      email: raw.properties?.email ?? null,
      firstname: raw.properties?.firstname ?? null,
      lastname: raw.properties?.lastname ?? null,
      phone: raw.properties?.phone ?? null,
      company: raw.properties?.company ?? null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  _normalizeDeal(raw) {
    return {
      id: raw.id,
      dealname: raw.properties?.dealname ?? null,
      amount: raw.properties?.amount ? Number(raw.properties.amount) : null,
      dealstage: raw.properties?.dealstage ?? null,
      pipeline: raw.properties?.pipeline ?? null,
      closedate: raw.properties?.closedate ?? null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}

module.exports = { HubSpotConnector };
