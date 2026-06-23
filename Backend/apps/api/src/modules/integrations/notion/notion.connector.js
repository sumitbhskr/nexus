'use strict';

const { BaseConnector } = require('../connector.base');
const logger = require('../../../common/utils/logger');

// ─── Notion API config ────────────────────────────────────────────────────────
// Notion requires a specific API version header on every request.
// Think of it like telling Notion "use this version of your rulebook" —
// so a future Notion API change won't silently break our connector.
// Docs: https://developers.notion.com/reference/intro

const NOTION_BASE_URL = 'https://api.notion.com/v1';
const NOTION_API_VERSION = '2022-06-28'; // Notion's stable version — do not bump without testing
const MAX_PAGE_SIZE = 100; // Notion hard limit per request

class NotionConnector extends BaseConnector {
  constructor(tenantId) {
    super(tenantId, 'Notion');

    const token = process.env.NOTION_API_KEY;

    if (token) {
      this.client = this.buildAxiosClient(NOTION_BASE_URL, {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_API_VERSION,
      });
    }
  }

  // ─── isConfigured ──────────────────────────────────────────────────────────
  isConfigured() {
    return Boolean(process.env.NOTION_API_KEY);
  }

  // ─── testConnection ────────────────────────────────────────────────────────
  // Fetches the bot user that owns the integration token.
  // Cheap single-object read — no data returned to caller.
  async testConnection() {
    if (!this.isConfigured()) {
      return { connected: false, reason: 'NOTION_API_KEY not set' };
    }

    try {
      const response = await this.withRetry(() => this.client.get('/users/me'));

      logger.info('Notion connection verified', {
        tenantId: this.tenantId,
        botName: response.data?.name,
      });

      return { connected: true, botName: response.data?.name ?? null };
    } catch (err) {
      const status = err.response?.status;
      const reason =
        status === 401
          ? 'Invalid or expired Notion API key'
          : status === 403
            ? 'Integration lacks access — share pages/DBs with the integration in Notion UI'
            : err.message;

      logger.warn('Notion connection test failed', {
        tenantId: this.tenantId,
        status,
        reason,
      });

      return { connected: false, reason };
    }
  }

  // ─── queryDatabase ─────────────────────────────────────────────────────────
  // Fetches rows from a Notion database matching optional filter + sort.
  //
  // `filter` follows Notion's filter object shape:
  //   { property: 'Status', select: { equals: 'Done' } }
  //
  // `sorts` is an array:
  //   [{ property: 'Due Date', direction: 'ascending' }]
  //
  // `startCursor` is the pagination cursor — Notion uses cursor pagination
  // (same concept as HubSpot's `after` token from earlier).
  async queryDatabase({ databaseId, filter, sorts, pageSize = 20, startCursor } = {}) {
    this._assertConfigured();

    if (!databaseId) {
      throw Object.assign(new Error('databaseId is required'), { status: 400 });
    }

    const body = {
      page_size: Math.min(pageSize, MAX_PAGE_SIZE),
    };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (startCursor) body.start_cursor = startCursor;

    const response = await this.withRetry(() =>
      this.client.post(`/databases/${databaseId}/query`, body)
    );

    return {
      pages: response.data.results.map(this._normalizePage),
      hasMore: response.data.has_more,
      nextCursor: response.data.next_cursor ?? null,
    };
  }

  // ─── createPage ────────────────────────────────────────────────────────────
  // Creates a new page (row) inside a Notion database.
  //
  // `properties` must match the target database's property schema.
  // Example for a DB with a "Name" title property and "Status" select:
  //   {
  //     Name:   { title: [{ text: { content: 'My Task' } }] },
  //     Status: { select: { name: 'In Progress' } }
  //   }
  //
  // `children` is an optional array of block objects appended as page body.
  async createPage({ databaseId, properties, children = [] }) {
    this._assertConfigured();

    if (!databaseId) {
      throw Object.assign(new Error('databaseId is required'), { status: 400 });
    }
    if (!properties || Object.keys(properties).length === 0) {
      throw Object.assign(new Error('properties are required to create a Notion page'), {
        status: 400,
      });
    }

    const body = {
      parent: { database_id: databaseId },
      properties,
      ...(children.length > 0 && { children }),
    };

    const response = await this.withRetry(() => this.client.post('/pages', body));

    logger.info('Notion page created', {
      tenantId: this.tenantId,
      pageId: response.data.id,
      databaseId,
    });

    return this._normalizePage(response.data);
  }

  // ─── updatePage ────────────────────────────────────────────────────────────
  // Updates properties of an existing Notion page (row).
  // Pass only the properties you want to change — Notion merges, not replaces.
  // To archive (soft-delete) a page, pass: { archived: true }
  async updatePage(pageId, { properties, archived } = {}) {
    this._assertConfigured();

    if (!pageId) {
      throw Object.assign(new Error('pageId is required'), { status: 400 });
    }
    if ((!properties || Object.keys(properties).length === 0) && archived === undefined) {
      throw Object.assign(new Error('At least one of properties or archived must be provided'), {
        status: 400,
      });
    }

    const body = {};
    if (properties) body.properties = properties;
    if (archived !== undefined) body.archived = Boolean(archived);

    const response = await this.withRetry(() => this.client.patch(`/pages/${pageId}`, body));

    logger.info('Notion page updated', { tenantId: this.tenantId, pageId });

    return this._normalizePage(response.data);
  }

  // ─── getPage ───────────────────────────────────────────────────────────────
  // Fetches a single page's metadata (properties, not body blocks).
  // Use appendBlock to read/write body content.
  async getPage(pageId) {
    this._assertConfigured();

    if (!pageId) {
      throw Object.assign(new Error('pageId is required'), { status: 400 });
    }

    const response = await this.withRetry(() => this.client.get(`/pages/${pageId}`));

    return this._normalizePage(response.data);
  }

  // ─── appendBlock ───────────────────────────────────────────────────────────
  // Appends block children (body content) to an existing page or block.
  // A "block" in Notion is any content unit: paragraph, heading, bullet, etc.
  //
  // `blocks` must be an array of Notion block objects. Examples:
  //   Paragraph:  { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Hello' } }] } }
  //   Heading 2:  { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'Section' } }] } }
  //   Bullet item:{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ text: { content: 'Item' } }] } }
  //
  // Notion API limit: max 100 blocks per request. Batching handled automatically.
  async appendBlock(blockId, blocks) {
    this._assertConfigured();

    if (!blockId) {
      throw Object.assign(new Error('blockId (page ID or parent block ID) is required'), {
        status: 400,
      });
    }
    if (!Array.isArray(blocks) || blocks.length === 0) {
      throw Object.assign(new Error('blocks must be a non-empty array'), { status: 400 });
    }

    // Notion hard limit: 100 blocks per PATCH — batch if caller sends more
    const BATCH_SIZE = 100;
    const results = [];

    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
      const chunk = blocks.slice(i, i + BATCH_SIZE);

      const response = await this.withRetry(() =>
        this.client.patch(`/blocks/${blockId}/children`, { children: chunk })
      );

      results.push(...(response.data.results ?? []));
    }

    logger.info('Notion blocks appended', {
      tenantId: this.tenantId,
      blockId,
      blockCount: blocks.length,
    });

    return { blockId, appended: results.length };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  _assertConfigured() {
    if (!this.isConfigured() || !this.client) {
      throw Object.assign(new Error('Notion integration is not configured. Set NOTION_API_KEY.'), {
        status: 503,
      });
    }
  }

  // Normalizes raw Notion page object to a clean, stable internal shape.
  // Notion's raw response nests heavily — this flattens what we always need.
  _normalizePage(raw) {
    return {
      id: raw.id,
      url: raw.url ?? null,
      archived: raw.archived ?? false,
      createdTime: raw.created_time ?? null,
      lastEditedTime: raw.last_edited_time ?? null,
      // Raw properties are kept as-is because their shape varies per database schema.
      // Callers should access specific properties by key from this object.
      properties: raw.properties ?? {},
    };
  }
}

module.exports = { NotionConnector };
