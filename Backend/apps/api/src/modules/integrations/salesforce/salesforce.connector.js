'use strict';

const { BaseConnector } = require('../connector.base');
const logger = require('../../../common/utils/logger');

class SalesforceConnector extends BaseConnector {
  constructor(tenantId) {
    super(tenantId, 'Salesforce');

    this._configured = !!(
      process.env.SALESFORCE_CLIENT_ID &&
      process.env.SALESFORCE_CLIENT_SECRET &&
      process.env.SALESFORCE_INSTANCE_URL
    );

    this._accessToken = null;
    this._tokenExpiresAt = null;
    this.instanceUrl = process.env.SALESFORCE_INSTANCE_URL;
  }

  isConfigured() {
    return this._configured;
  }

  // ─── OAuth2 Client Credentials flow ──────────────────────────
  async authenticate() {
    if (
      this._accessToken &&
      this._tokenExpiresAt &&
      this._tokenExpiresAt > Date.now() + 60000
    ) {
      return this._accessToken;
    }

    if (!this.isConfigured()) {
      throw new Error('Salesforce not configured');
    }

    const axios = require('axios');
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SALESFORCE_CLIENT_ID,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET,
    });

    const res = await axios.post(
      `${this.instanceUrl}/services/oauth2/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    this._accessToken = res.data.access_token;
    this._tokenExpiresAt = Date.now() + (res.data.expires_in || 3600) * 1000;

    this.client = this.buildAxiosClient(
      `${this.instanceUrl}/services/data/v59.0`,
      { Authorization: `Bearer ${this._accessToken}` }
    );

    logger.info('Salesforce authenticated', { tenantId: this.tenantId });
    return this._accessToken;
  }

  async testConnection() {
    if (!this.isConfigured()) return { connected: false, reason: 'Not configured' };

    try {
      await this.authenticate();
      const res = await this.withRetry(() => this.client.get('/limits'));
      return { connected: true, apiUsage: res.data?.DailyApiRequests };
    } catch (err) {
      return { connected: false, reason: err.message };
    }
  }

  // ─── Get accounts ─────────────────────────────────────────────
  async getAccounts({ filter = 'all', limit = 20, fields }) {
    if (!this.isConfigured()) {
      return this._mockAccounts(filter, limit);
    }

    await this.authenticate();

    const defaultFields = [
      'Id', 'Name', 'AnnualRevenue', 'NumberOfEmployees',
      'Type', 'Industry', 'OwnerId', 'LastActivityDate',
      'Health_Score__c', 'CSM__c', 'ARR__c',
    ];
    const selectedFields = fields || defaultFields;

    let whereClause = '';
    if (filter === 'at_risk') whereClause = "WHERE Health_Score__c < 50";
    else if (filter === 'healthy') whereClause = "WHERE Health_Score__c >= 70";
    else if (filter === 'churned') whereClause = "WHERE Type = 'Former Customer'";

    const soql = `SELECT ${selectedFields.join(',')} FROM Account ${whereClause} ORDER BY LastActivityDate DESC LIMIT ${limit}`;

    const res = await this.withRetry(() =>
      this.client.get('/query', { params: { q: soql } })
    );

    return {
      accounts: res.data.records.map((r) => ({
        id: r.Id,
        name: r.Name,
        arr: r.ARR__c || r.AnnualRevenue || 0,
        healthScore: r.Health_Score__c || 50,
        csm: r.CSM__c,
        industry: r.Industry,
        lastActivity: r.LastActivityDate,
        status: r.Health_Score__c < 40
          ? 'at_risk'
          : r.Health_Score__c < 70
          ? 'monitor'
          : 'healthy',
      })),
      total: res.data.totalSize,
    };
  }

  // ─── Get opportunities ────────────────────────────────────────
  async getOpportunities({ stage, limit = 20 } = {}) {
    if (!this.isConfigured()) {
      return { opportunities: [], source: 'mock' };
    }

    await this.authenticate();

    let whereClause = stage ? `WHERE StageName = '${stage}'` : '';
    const soql = `SELECT Id,Name,Amount,StageName,CloseDate,AccountId,OwnerId FROM Opportunity ${whereClause} ORDER BY CloseDate ASC LIMIT ${limit}`;

    const res = await this.withRetry(() =>
      this.client.get('/query', { params: { q: soql } })
    );

    return {
      opportunities: res.data.records,
      total: res.data.totalSize,
    };
  }

  // ─── Create task (activity) ───────────────────────────────────
  async createTask({ subject, description, accountId, dueDate, priority = 'Normal' }) {
    if (!this.isConfigured()) {
      return { id: `mock-${Date.now()}`, status: 'created', source: 'mock' };
    }

    await this.authenticate();

    const res = await this.withRetry(() =>
      this.client.post('/sobjects/Task', {
        Subject: subject,
        Description: description,
        WhatId: accountId,
        ActivityDate: dueDate,
        Priority: priority,
        Status: 'Not Started',
      })
    );

    return { id: res.data.id, status: 'created' };
  }

  // ─── Mock data ────────────────────────────────────────────────
  _mockAccounts(filter, limit) {
    const accounts = [
      { id: 'SF001', name: 'Acme Corp', arr: 180000, healthScore: 32, csm: 'Jane Smith', status: 'at_risk', industry: 'Technology', lastActivity: new Date(Date.now() - 14 * 86400000).toISOString() },
      { id: 'SF002', name: 'TechFlow Inc', arr: 95000, healthScore: 41, csm: 'Bob Lee', status: 'at_risk', industry: 'SaaS', lastActivity: new Date(Date.now() - 7 * 86400000).toISOString() },
      { id: 'SF003', name: 'DataSync Ltd', arr: 220000, healthScore: 38, csm: 'Jane Smith', status: 'at_risk', industry: 'Data', lastActivity: new Date(Date.now() - 10 * 86400000).toISOString() },
      { id: 'SF004', name: 'CloudBase', arr: 310000, healthScore: 87, csm: 'Mike Chen', status: 'healthy', industry: 'Cloud', lastActivity: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: 'SF005', name: 'StartupXYZ', arr: 42000, healthScore: 54, csm: 'Bob Lee', status: 'monitor', industry: 'Startup', lastActivity: new Date(Date.now() - 5 * 86400000).toISOString() },
    ];

    const filtered = filter === 'all'
      ? accounts
      : accounts.filter((a) => a.status === filter);

    return { accounts: filtered.slice(0, limit), total: filtered.length, source: 'mock' };
  }
}

module.exports = { SalesforceConnector };