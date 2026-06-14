'use strict';

const axios = require('axios');
const { BaseConnector } = require('../connector.base');
const logger = require('../../../common/utils/logger');

class SlackConnector extends BaseConnector {
  constructor(tenantId) {
    super(tenantId, 'Slack');

    const token = process.env.SLACK_BOT_TOKEN;

    if (!token) {
      this._configured = false;
      return;
    }

    this._configured = true;
    this.signingSecret = process.env.SLACK_SIGNING_SECRET;

    this.client = this.buildAxiosClient(
      'https://slack.com/api',
      { Authorization: `Bearer ${token}` }
    );
  }

  isConfigured() {
    return this._configured;
  }

  async testConnection() {
    if (!this.isConfigured()) return { connected: false, reason: 'Not configured' };

    try {
      const res = await this.withRetry(() => this.client.get('/auth.test'));
      if (!res.data.ok) return { connected: false, reason: res.data.error };

      return {
        connected: true,
        team: res.data.team,
        botName: res.data.user,
      };
    } catch (err) {
      return { connected: false, reason: err.message };
    }
  }

  // ─── Post message ─────────────────────────────────────────────
  async postMessage({ channel, text, blocks, attachments, threadTs }) {
    if (!this.isConfigured()) {
      logger.warn('Slack not configured — skipping message', {
        channel,
        tenantId: this.tenantId,
      });
      return { messageId: `mock-${Date.now()}`, channel, status: 'mock' };
    }

    const payload = {
      channel: channel.startsWith('#') ? channel : `#${channel}`,
      text,
    };

    if (blocks) payload.blocks = blocks;
    if (attachments) payload.attachments = attachments;
    if (threadTs) payload.thread_ts = threadTs;

    const res = await this.withRetry(() =>
      this.client.post('/chat.postMessage', payload)
    );

    if (!res.data.ok) {
      throw new Error(`Slack API error: ${res.data.error}`);
    }

    logger.info('Slack message posted', {
      channel,
      ts: res.data.ts,
      tenantId: this.tenantId,
    });

    return {
      messageId: res.data.ts,
      channel: res.data.channel,
      status: 'sent',
    };
  }

  // ─── Post rich Block Kit message ──────────────────────────────
  async postRichMessage({ channel, title, body, color = '#3b82f6', fields = [] }) {
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: title },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: body },
      },
    ];

    if (fields.length > 0) {
      blocks.push({
        type: 'section',
        fields: fields.map((f) => ({
          type: 'mrkdwn',
          text: `*${f.label}:*\n${f.value}`,
        })),
      });
    }

    return this.postMessage({ channel, text: title, blocks });
  }

  // ─── List channels ────────────────────────────────────────────
  async listChannels(limit = 100) {
    if (!this.isConfigured()) return { channels: [], source: 'mock' };

    const res = await this.withRetry(() =>
      this.client.get('/conversations.list', {
        params: { limit, exclude_archived: true, types: 'public_channel,private_channel' },
      })
    );

    if (!res.data.ok) throw new Error(`Slack API error: ${res.data.error}`);

    return {
      channels: res.data.channels.map((c) => ({
        id: c.id,
        name: c.name,
        isPrivate: c.is_private,
        memberCount: c.num_members,
      })),
    };
  }

  // ─── Verify webhook signature ─────────────────────────────────
  verifyWebhookSignature(rawBody, signature, timestamp) {
    if (!this.signingSecret) return false;

    const crypto = require('crypto');
    const fiveMinutes = 300;

    if (Math.abs(Date.now() / 1000 - timestamp) > fiveMinutes) {
      return false;
    }

    const sigBaseString = `v0:${timestamp}:${rawBody}`;
    const mySignature =
      'v0=' +
      crypto
        .createHmac('sha256', this.signingSecret)
        .update(sigBaseString)
        .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(signature)
    );
  }
}

module.exports = { SlackConnector };