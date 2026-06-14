'use strict';

const jwt = require('jsonwebtoken');
const { getRedisClient, KEYS } = require('../../config/redis');
const { AuthenticationError, AuthorizationError } = require('./errorHandler');
const logger = require('../utils/logger');

// ─── Verify JWT access token ──────────────────────────────────────────────────
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Bearer token required');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new AuthenticationError('Token missing');
    }

    // Verify signature and expiry
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AuthenticationError('Access token expired — refresh required');
      }
      throw new AuthenticationError('Invalid access token');
    }

    // Check token blacklist (logout / forced invalidation)
    const redis = getRedisClient();
    if (redis) {
      const blacklisted = await redis.get(KEYS.sessionBlacklist(decoded.jti));
      if (blacklisted) {
        throw new AuthenticationError('Token has been revoked');
      }
    }

    // Attach user context to request
    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      email: decoded.email,
      role: decoded.role,
      jti: decoded.jti,
    };

    // Convenience aliases
    req.tenantId = decoded.tenantId;
    req.userId = decoded.userId;

    next();
  } catch (err) {
    next(err);
  }
}

// ─── RBAC — role hierarchy ────────────────────────────────────────────────────
const ROLE_HIERARCHY = {
  admin: 4,
  manager: 3,
  analyst: 2,
  viewer: 1,
};

function authorize(...allowedRoles) {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
      const hasPermission = allowedRoles.some(
        (role) => userRoleLevel >= (ROLE_HIERARCHY[role] || 0)
      );

      if (!hasPermission) {
        logger.warn('Authorization denied', {
          userId: req.user.userId,
          userRole: req.user.role,
          requiredRoles: allowedRoles,
          path: req.originalUrl,
        });
        throw new AuthorizationError(
          `Role '${req.user.role}' cannot access this resource. Required: ${allowedRoles.join(' or ')}`
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

// ─── Tenant isolation guard ───────────────────────────────────────────────────
// Ensures resource tenantId matches authenticated user tenantId
function enforceTenantIsolation(req, res, next) {
  try {
    const resourceTenantId = req.params.tenantId || req.body?.tenantId || req.query?.tenantId;

    if (resourceTenantId && resourceTenantId !== req.tenantId) {
      logger.warn('Tenant isolation violation attempt', {
        userId: req.user.userId,
        userTenantId: req.tenantId,
        requestedTenantId: resourceTenantId,
        path: req.originalUrl,
      });
      throw new AuthorizationError('Cross-tenant access denied');
    }

    next();
  } catch (err) {
    next(err);
  }
}

// ─── Optional auth (public routes that benefit from user context) ─────────────
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    await authenticate(req, res, next);
  } catch {
    // Silently continue without user context
    next();
  }
}

module.exports = {
  authenticate,
  authorize,
  enforceTenantIsolation,
  optionalAuthenticate,
  ROLE_HIERARCHY,
};
