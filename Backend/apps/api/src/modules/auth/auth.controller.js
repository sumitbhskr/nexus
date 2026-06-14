'use strict';

const authService = require('./auth.service');
const { ValidationError } = require('../../common/middleware/errorHandler');
const logger = require('../../common/utils/logger');

// ─── POST /api/v1/auth/register ───────────────────────────────────────────────
async function register(req, res) {
  const { tenantName, email, password, firstName, lastName } = req.body;

  // Input validation
  if (!tenantName || !email || !password || !firstName || !lastName) {
    throw new ValidationError(
      'All fields required: tenantName, email, password, firstName, lastName'
    );
  }

  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('Invalid email address');
  }

  const { user, tenant } = await authService.register({
    tenantName,
    email,
    password,
    firstName,
    lastName,
  });

  res.status(201).json({
    success: true,
    message: 'Account created successfully',
    data: {
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      tenant: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
      },
    },
  });
}

// ─── POST /api/v1/auth/login ──────────────────────────────────────────────────
async function login(req, res) {
  const { email, password, deviceId } = req.body;

  if (!email || !password) {
    throw new ValidationError('Email and password are required');
  }

  const result = await authService.login({
    email,
    password,
    deviceId: deviceId || 'web',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({
    success: true,
    message: 'Login successful',
    data: result,
  });
}

// ─── POST /api/v1/auth/refresh ────────────────────────────────────────────────
async function refresh(req, res) {
  const { refreshToken } = req.body;

  const tokens = await authService.refreshAccessToken({
    refreshToken,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({
    success: true,
    data: tokens,
  });
}

// ─── DELETE /api/v1/auth/logout ───────────────────────────────────────────────
async function logout(req, res) {
  const { refreshToken } = req.body;

  await authService.logout({
    userId: req.user.userId,
    refreshToken,
    jti: req.user.jti,
  });

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}

// ─── DELETE /api/v1/auth/logout-all ──────────────────────────────────────────
async function logoutAll(req, res) {
  await authService.logoutAllDevices(req.user.userId);

  res.json({
    success: true,
    message: 'Logged out from all devices',
  });
}

// ─── GET /api/v1/auth/me ──────────────────────────────────────────────────────
async function getMe(req, res) {
  const user = await authService.getMe(req.user.userId);

  res.json({
    success: true,
    data: { user },
  });
}

// ─── PATCH /api/v1/auth/change-password ──────────────────────────────────────
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ValidationError('currentPassword and newPassword are required');
  }

  await authService.changePassword({
    userId: req.user.userId,
    currentPassword,
    newPassword,
  });

  res.json({
    success: true,
    message: 'Password changed successfully — please log in again',
  });
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  changePassword,
};
