'use strict';

const { BaseConnector } = require('../connector.base');
const logger = require('../../../common/utils/logger');

// ─── Google Sheets API config ─────────────────────────────────────────────────
// Google Sheets v4 REST API uses OAuth2 access tokens.
// For server-to-server (no user login), use a Service Account:
//   1. Create a Service Account in Google Cloud Console
//   2. Share your Google Sheet with the service account's email
//   3. Generate a JSON key → extract access_token via google-auth-library
//      OR use a short-lived token fetched via the OAuth2 token endpoint
//
// For simplicity without adding googleapis SDK, this connector expects
// a pre-fetched OAuth2 access token set in GOOGLE_SHEETS_ACCESS_TOKEN.
// In production, token refresh should be handled by a separate auth helper
// (e.g., using google-auth-library) that updates the env / secrets store.
//
// Docs: https://developers.google.com/sheets/api/reference/rest

const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4';

// Value input option — controls how input strings are interpreted:
//   RAW        → stored exactly as typed (no formula parsing)
//   USER_ENTERED → same as typing in the Sheets UI (formulas work, dates parse)
const DEFAULT_VALUE_INPUT_OPTION = 'USER_ENTERED';

// Value render option — controls how values are returned on reads:
//   FORMATTED_VALUE → what the user sees (e.g., "$1,234.00")
//   UNFORMATTED_VALUE → raw number (e.g., 1234)
//   FORMULA → raw formula string (e.g., "=SUM(A1:A10)")
const DEFAULT_VALUE_RENDER_OPTION = 'FORMATTED_VALUE';

class GoogleSheetsConnector extends BaseConnector {
  constructor(tenantId) {
    super(tenantId, 'GoogleSheets');

    const token = process.env.GOOGLE_SHEETS_ACCESS_TOKEN;

    if (token) {
      this.client = this.buildAxiosClient(SHEETS_BASE_URL, { Authorization: `Bearer ${token}` });
    }
  }

  // ─── isConfigured ──────────────────────────────────────────────────────────
  isConfigured() {
    return Boolean(process.env.GOOGLE_SHEETS_ACCESS_TOKEN);
  }

  // ─── testConnection ────────────────────────────────────────────────────────
  // Reads spreadsheet metadata using GOOGLE_SHEETS_TEST_SPREADSHEET_ID.
  // If no test ID is set, returns configured=true but skips live check.
  // This avoids a hard failure at startup just because no test sheet is set.
  async testConnection() {
    if (!this.isConfigured()) {
      return { connected: false, reason: 'GOOGLE_SHEETS_ACCESS_TOKEN not set' };
    }

    const testId = process.env.GOOGLE_SHEETS_TEST_SPREADSHEET_ID;
    if (!testId) {
      logger.warn(
        'GoogleSheets testConnection skipped — GOOGLE_SHEETS_TEST_SPREADSHEET_ID not set',
        {
          tenantId: this.tenantId,
        }
      );
      return {
        connected: true,
        warning: 'No test spreadsheet ID configured — token not verified live',
      };
    }

    try {
      const response = await this.withRetry(() =>
        this.client.get(`/spreadsheets/${testId}`, {
          params: { fields: 'spreadsheetId,properties.title' },
        })
      );

      logger.info('GoogleSheets connection verified', {
        tenantId: this.tenantId,
        spreadsheetTitle: response.data?.properties?.title,
      });

      return {
        connected: true,
        spreadsheetTitle: response.data?.properties?.title ?? null,
      };
    } catch (err) {
      const status = err.response?.status;
      const reason =
        status === 401
          ? 'Access token expired or invalid — refresh GOOGLE_SHEETS_ACCESS_TOKEN'
          : status === 403
            ? 'Service account lacks access — share the sheet with the service account email'
            : status === 404
              ? 'Test spreadsheet not found — verify GOOGLE_SHEETS_TEST_SPREADSHEET_ID'
              : err.message;

      logger.warn('GoogleSheets connection test failed', {
        tenantId: this.tenantId,
        status,
        reason,
      });

      return { connected: false, reason };
    }
  }

  // ─── getSheetMetadata ──────────────────────────────────────────────────────
  // Returns spreadsheet title + list of all sheet (tab) names and their IDs.
  // Useful to discover what tabs exist before reading/writing ranges.
  async getSheetMetadata(spreadsheetId) {
    this._assertConfigured();
    this._assertSpreadsheetId(spreadsheetId);

    const response = await this.withRetry(() =>
      this.client.get(`/spreadsheets/${spreadsheetId}`, {
        params: { fields: 'spreadsheetId,properties.title,sheets.properties' },
      })
    );

    const sheets = (response.data.sheets ?? []).map((s) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title,
      index: s.properties?.index,
      rowCount: s.properties?.gridProperties?.rowCount,
      columnCount: s.properties?.gridProperties?.columnCount,
    }));

    return {
      spreadsheetId: response.data.spreadsheetId,
      title: response.data.properties?.title ?? null,
      sheets,
    };
  }

  // ─── readRange ─────────────────────────────────────────────────────────────
  // Reads a cell range from a sheet.
  //
  // `range` uses A1 notation — same as what you'd type in Sheets:
  //   'Sheet1!A1:D10'  → rows 1–10, columns A–D of "Sheet1"
  //   'Sheet1!A:A'     → entire column A
  //   'Sheet1'         → entire sheet
  //
  // Returns a 2D array: rows → columns. Empty cells are omitted by Sheets API
  // (trailing empty cells in a row are dropped). Handle sparse rows in caller.
  async readRange(spreadsheetId, range, { valueRenderOption = DEFAULT_VALUE_RENDER_OPTION } = {}) {
    this._assertConfigured();
    this._assertSpreadsheetId(spreadsheetId);
    this._assertRange(range);

    const response = await this.withRetry(() =>
      this.client.get(`/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
        params: { valueRenderOption },
      })
    );

    return {
      range: response.data.range,
      values: response.data.values ?? [], // [] if the range is completely empty
      rowCount: (response.data.values ?? []).length,
    };
  }

  // ─── writeRange ────────────────────────────────────────────────────────────
  // Overwrites a range with provided values (2D array).
  // Existing data in cells not covered by the new values is preserved.
  // To erase a range first, call clearRange() before writeRange().
  //
  // `values` must be a 2D array:
  //   [ ['Name', 'Email'], ['Alice', 'alice@example.com'] ]
  async writeRange(
    spreadsheetId,
    range,
    values,
    { valueInputOption = DEFAULT_VALUE_INPUT_OPTION } = {}
  ) {
    this._assertConfigured();
    this._assertSpreadsheetId(spreadsheetId);
    this._assertRange(range);

    if (!Array.isArray(values) || values.length === 0) {
      throw Object.assign(new Error('values must be a non-empty 2D array'), { status: 400 });
    }

    const response = await this.withRetry(() =>
      this.client.put(
        `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
        { range, majorDimension: 'ROWS', values },
        { params: { valueInputOption } }
      )
    );

    logger.info('GoogleSheets range written', {
      tenantId: this.tenantId,
      spreadsheetId,
      range,
      updatedCells: response.data.updatedCells,
    });

    return {
      updatedRange: response.data.updatedRange,
      updatedRows: response.data.updatedRows,
      updatedColumns: response.data.updatedColumns,
      updatedCells: response.data.updatedCells,
    };
  }

  // ─── appendRows ────────────────────────────────────────────────────────────
  // Appends rows AFTER the last row with data in the given range.
  // Sheets API auto-detects the "table" boundary — it finds the last
  // non-empty row in the range and appends immediately below it.
  // This is the safest way to add new records without overwriting anything.
  //
  // `insertDataOption`:
  //   OVERWRITE      → overwrites existing data starting from the detected boundary (rare use)
  //   INSERT_ROWS    → inserts new rows, pushing existing rows down (safer default)
  async appendRows(
    spreadsheetId,
    range,
    rows,
    { valueInputOption = DEFAULT_VALUE_INPUT_OPTION, insertDataOption = 'INSERT_ROWS' } = {}
  ) {
    this._assertConfigured();
    this._assertSpreadsheetId(spreadsheetId);
    this._assertRange(range);

    if (!Array.isArray(rows) || rows.length === 0) {
      throw Object.assign(new Error('rows must be a non-empty 2D array'), { status: 400 });
    }

    const response = await this.withRetry(() =>
      this.client.post(
        `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append`,
        { majorDimension: 'ROWS', values: rows },
        { params: { valueInputOption, insertDataOption } }
      )
    );

    logger.info('GoogleSheets rows appended', {
      tenantId: this.tenantId,
      spreadsheetId,
      range,
      updatedCells: response.data.updates?.updatedCells,
    });

    return {
      updatedRange: response.data.updates?.updatedRange ?? null,
      updatedRows: response.data.updates?.updatedRows ?? 0,
      updatedCells: response.data.updates?.updatedCells ?? 0,
    };
  }

  // ─── clearRange ────────────────────────────────────────────────────────────
  // Clears all values from a range (does NOT delete rows/columns — only empties cells).
  // Cell formatting (colors, fonts) is preserved. Data is gone.
  async clearRange(spreadsheetId, range) {
    this._assertConfigured();
    this._assertSpreadsheetId(spreadsheetId);
    this._assertRange(range);

    const response = await this.withRetry(() =>
      this.client.post(
        `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
        {}
      )
    );

    logger.info('GoogleSheets range cleared', {
      tenantId: this.tenantId,
      spreadsheetId,
      clearedRange: response.data.clearedRange,
    });

    return {
      spreadsheetId: response.data.spreadsheetId,
      clearedRange: response.data.clearedRange,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  _assertConfigured() {
    if (!this.isConfigured() || !this.client) {
      throw Object.assign(
        new Error('Google Sheets integration is not configured. Set GOOGLE_SHEETS_ACCESS_TOKEN.'),
        { status: 503 }
      );
    }
  }

  _assertSpreadsheetId(id) {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw Object.assign(new Error('spreadsheetId is required'), { status: 400 });
    }
  }

  _assertRange(range) {
    if (!range || typeof range !== 'string' || range.trim().length === 0) {
      throw Object.assign(new Error("range is required (A1 notation, e.g., 'Sheet1!A1:D10')"), {
        status: 400,
      });
    }
  }
}

module.exports = { GoogleSheetsConnector };
