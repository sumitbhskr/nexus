'use strict';

const { BaseConnector } = require('../connector.base');
const logger = require('../../../common/utils/logger');

class JiraConnector extends BaseConnector {
  constructor(tenantId) {
    super(tenantId, 'Jira');

    const baseURL = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;

    if (!baseURL || !email || !token) {
      this._configured = false;
      return;
    }

    this._configured = true;
    this.projectKey = process.env.JIRA_PROJECT_KEY || 'NEXUS';

    // Jira uses HTTP Basic Auth: email:api_token encoded in base64
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    this.client = this.buildAxiosClient(`${baseURL}/rest/api/3`, {
      Authorization: `Basic ${auth}`,
    });
  }

  isConfigured() {
    return this._configured;
  }

  // ─── Test connection ──────────────────────────────────────────
  async testConnection() {
    if (!this.isConfigured()) return { connected: false, reason: 'Not configured' };

    try {
      const res = await this.withRetry(() => this.client.get('/myself'));
      return {
        connected: true,
        account: res.data.displayName,
        email: res.data.emailAddress,
      };
    } catch (err) {
      return { connected: false, reason: err.message };
    }
  }

  // ─── Create issue ─────────────────────────────────────────────
  async createIssue({
    title,
    description,
    priority = 'Medium',
    issueType = 'Task',
    assignee,
    labels = [],
  }) {
    if (!this.isConfigured()) {
      return this._mockCreateIssue(title, priority);
    }

    const payload = {
      fields: {
        project: { key: this.projectKey },
        summary: title,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: description || title }],
            },
          ],
        },
        issuetype: { name: issueType },
        priority: { name: priority },
        labels: ['nexus-agent', ...labels],
      },
    };

    if (assignee) {
      payload.fields.assignee = { emailAddress: assignee };
    }

    const res = await this.withRetry(() => this.client.post('/issue', payload));

    logger.info('Jira issue created', {
      issueKey: res.data.key,
      tenantId: this.tenantId,
    });

    return {
      issueKey: res.data.key,
      issueId: res.data.id,
      url: `${process.env.JIRA_BASE_URL}/browse/${res.data.key}`,
      status: 'created',
    };
  }

  // ─── Update issue ─────────────────────────────────────────────
  async updateIssue(issueKey, updates = {}) {
    if (!this.isConfigured()) {
      return { issueKey, status: 'updated', source: 'mock' };
    }

    const fields = {};
    if (updates.status) {
      // Transition the issue
      return this.transitionIssue(issueKey, updates.status);
    }
    if (updates.priority) fields.priority = { name: updates.priority };
    if (updates.assignee) fields.assignee = { emailAddress: updates.assignee };
    if (updates.labels) fields.labels = updates.labels;

    await this.withRetry(() => this.client.put(`/issue/${issueKey}`, { fields }));

    return { issueKey, status: 'updated' };
  }

  // ─── Transition issue (change status) ────────────────────────
  async transitionIssue(issueKey, targetStatus) {
    if (!this.isConfigured()) return { issueKey, status: 'transitioned', source: 'mock' };

    // Get available transitions
    const transRes = await this.withRetry(() => this.client.get(`/issue/${issueKey}/transitions`));

    const transition = transRes.data.transitions.find(
      (t) => t.name.toLowerCase() === targetStatus.toLowerCase()
    );

    if (!transition) {
      throw new Error(`Transition '${targetStatus}' not available for ${issueKey}`);
    }

    await this.withRetry(() =>
      this.client.post(`/issue/${issueKey}/transitions`, {
        transition: { id: transition.id },
      })
    );

    return { issueKey, status: targetStatus };
  }

  // ─── Get issues by JQL ────────────────────────────────────────
  async searchIssues(jql, fields = ['summary', 'status', 'priority', 'assignee'], maxResults = 20) {
    if (!this.isConfigured()) {
      return { issues: [], total: 0, source: 'mock' };
    }

    const res = await this.withRetry(() =>
      this.client.post('/issue/search', { jql, fields, maxResults })
    );

    return {
      issues: res.data.issues.map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name,
        priority: i.fields.priority?.name,
        assignee: i.fields.assignee?.displayName,
      })),
      total: res.data.total,
    };
  }

  // ─── Add comment ──────────────────────────────────────────────
  async addComment(issueKey, comment) {
    if (!this.isConfigured()) return { status: 'added', source: 'mock' };

    await this.withRetry(() =>
      this.client.post(`/issue/${issueKey}/comment`, {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: comment }],
            },
          ],
        },
      })
    );

    return { issueKey, status: 'comment_added' };
  }

  // ─── Mock fallback ────────────────────────────────────────────
  _mockCreateIssue(title, priority) {
    const key = `${this.projectKey}-${Math.floor(Math.random() * 9000) + 1000}`;
    return {
      issueKey: key,
      issueId: `mock-${Date.now()}`,
      url: `https://your-org.atlassian.net/browse/${key}`,
      status: 'created',
      source: 'mock',
    };
  }
}

module.exports = { JiraConnector };
