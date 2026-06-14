'use strict';

const axios = require('axios');
const logger = require('../../common/utils/logger');

// ─── Base connector all integrations extend ───────────────────────────────────
class BaseConnector {
  constructor(tenantId, providerName) {
    this.tenantId = tenantId;
    this.providerName = providerName;
    this.client = null;
  }

  // ─── Retry with exponential backoff ────────────────────────
  async withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        // Don't retry on client errors (4xx) except 429
        if (
          err.response?.status &&
          err.response.status >= 400 &&
          err.response.status < 500 &&
          err.response.status !== 429
        ) {
          throw err;
        }

        if (attempt < maxAttempts) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 200;

          logger.warn(`${this.providerName} request failed — retrying`, {
            attempt,
            maxAttempts,
            delayMs: Math.round(delay + jitter),
            error: err.message,
            status: err.response?.status,
          });

          await new Promise((r) => setTimeout(r, delay + jitter));
        }
      }
    }

    throw lastError;
  }

  // ─── Build axios instance with timeout + logging ────────────
  buildAxiosClient(baseURL, headers = {}, timeoutMs = 15000) {
    const client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      timeout: timeoutMs,
    });

    // Request interceptor
    client.interceptors.request.use((config) => {
      logger.debug(`${this.providerName} API request`, {
        method: config.method?.toUpperCase(),
        url: config.url,
        tenantId: this.tenantId,
      });
      return config;
    });

    // Response interceptor
    client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.warn(`${this.providerName} API error`, {
          status: error.response?.status,
          url: error.config?.url,
          message: error.response?.data?.message || error.message,
          tenantId: this.tenantId,
        });
        return Promise.reject(error);
      }
    );

    return client;
  }

  // ─── Check if integration is configured ─────────────────────
  isConfigured() {
    throw new Error(`${this.providerName}.isConfigured() must be implemented`);
  }

  // ─── Verify connectivity ─────────────────────────────────────
  async testConnection() {
    throw new Error(`${this.providerName}.testConnection() must be implemented`);
  }
}

module.exports = { BaseConnector };