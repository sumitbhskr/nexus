'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ─── Audit Log Schema ─────────────────────────────────────────────────────────
const auditLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    userEmail: {
      type: String,
      default: null,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    resource: {
      type: String,
      required: true,
    },
    resourceId: {
      type: String,
      default: null,
    },
    outcome: {
      type: String,
      enum: ['success', 'failure', 'denied'],
      default: 'success',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ip: String,
    userAgent: String,
    requestId: String,
    durationMs: Number,
  },
  {
    timestamps: { createdAt: 'ts', updatedAt: false },
    collection: 'audit_logs',
  }
);

// TTL index — auto-delete logs after 1 year
auditLogSchema.index({ ts: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
auditLogSchema.index({ tenantId: 1, ts: -1 });
auditLogSchema.index({ tenantId: 1, action: 1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ─── Write audit log (fire-and-forget — never blocks request) ─────────────────
async function writeAuditLog(data) {
  try {
    await AuditLog.create(data);
  } catch (err) {
    // Log the failure but don't throw — audit log must never break the request
    logger.error('Failed to write audit log', {
      error: err.message,
      action: data.action,
    });
  }
}

// ─── Audit middleware factory ─────────────────────────────────────────────────
function auditLog(action, resource) {
  return async (req, res, next) => {
    const start = Date.now();

    // Intercept response to capture outcome
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      const durationMs = Date.now() - start;
      const outcome =
        res.statusCode >= 500 ? 'failure' : res.statusCode === 403 ? 'denied' : 'success';

      // Write asynchronously — do not await
      writeAuditLog({
        tenantId: req.tenantId,
        userId: req.user?.userId || null,
        userEmail: req.user?.email || null,
        action,
        resource,
        resourceId:
          req.params.id || req.params.workflowId || req.params.agentId || body?.data?._id || null,
        outcome,
        metadata: {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          requestBody: sanitizeBody(req.body),
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId,
        durationMs,
      });

      return originalJson(body);
    };

    next();
  };
}

// Remove sensitive fields before logging
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const sensitive = ['password', 'token', 'secret', 'apiKey', 'privateKey', 'credentials'];
  const sanitized = { ...body };
  sensitive.forEach((key) => {
    if (sanitized[key]) sanitized[key] = '[REDACTED]';
  });
  return sanitized;
}

module.exports = { auditLog, writeAuditLog, AuditLog };
