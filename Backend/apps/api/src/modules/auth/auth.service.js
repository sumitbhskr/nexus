'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { User, Tenant } = require('./auth.model');
const { getRedisClient, KEYS } = require('../../config/redis');
const {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} = require('../../common/middleware/errorHandler');
const logger = require('../../common/utils/logger');

const MAX_REFRESH_TOKENS_PER_USER = 5;

// ─── Token generation ─────────────────────────────────────────────────────────
function generateAccessToken(user) {
  const jti = uuidv4();
  return {
    token: jwt.sign(
      {
        userId: user._id.toString(),
        tenantId: user.tenantId.toString(),
        email: user.email,
        role: user.role,
        jti,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    ),
    jti,
  };
}

function generateRefreshToken(user) {
  const token = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  return { token, expiresAt };
}

// ─── Register ─────────────────────────────────────────────────────────────────
async function register({ tenantName, email, password, firstName, lastName }) {
  // Check if email already exists across tenants
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ConflictError('Email already registered');
  }

  // Create tenant
  const tenantSlug = tenantName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);

  const existingTenant = await Tenant.findOne({ slug: tenantSlug });
  if (existingTenant) {
    throw new ConflictError('Organization name already taken');
  }

  const tenant = await Tenant.create({
    name: tenantName,
    slug: tenantSlug,
    plan: 'starter',
  });

  // Create admin user
  const user = await User.create({
    tenantId: tenant._id,
    email,
    passwordHash: password, // pre-save hook will hash this
    firstName,
    lastName,
    role: 'admin',
    isEmailVerified: true, // skip email verification for now
  });

  logger.info('New tenant and admin user registered', {
    tenantId: tenant._id,
    userId: user._id,
    email,
  });

  return { user, tenant };
}

// ─── Login ────────────────────────────────────────────────────────────────────
async function login({ email, password, deviceId = 'unknown', ip, userAgent }) {
  // Fetch user WITH passwordHash and refreshTokens
  const user = await User.findOne({ email, isActive: true })
    .select('+passwordHash +refreshTokens')
    .populate('tenantId', 'name slug plan isActive');

  if (!user) {
    throw new AuthenticationError('Invalid email or password');
  }

  if (!user.tenantId?.isActive) {
    throw new AuthorizationError('Your organization account is inactive');
  }

  // Check account lock
  if (user.isLocked) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new AuthenticationError(
      `Account locked — too many failed attempts. Try again in ${minutesLeft} minutes`
    );
  }

  // Verify password
  const isValidPassword = await user.comparePassword(password);

  if (!isValidPassword) {
    await user.incrementLoginAttempts();
    const remaining = 5 - (user.loginAttempts + 1);
    throw new AuthenticationError(
      remaining > 0
        ? `Invalid email or password (${remaining} attempts remaining)`
        : 'Account locked due to too many failed attempts'
    );
  }

  // Clear failed attempts
  await user.clearLoginAttempts();

  // Generate tokens
  const { token: accessToken, jti } = generateAccessToken(user);
  const { token: refreshToken, expiresAt } = generateRefreshToken(user);

  // Store refresh token (limit to 5 per user)
  user.cleanExpiredTokens();

  if (user.refreshTokens.length >= MAX_REFRESH_TOKENS_PER_USER) {
    // Remove oldest token
    user.refreshTokens.sort((a, b) => a.createdAt - b.createdAt);
    user.refreshTokens.shift();
  }

  user.refreshTokens.push({ token: refreshToken, deviceId, userAgent, ip, expiresAt });
  await user.save();

  logger.info('User logged in', {
    userId: user._id,
    tenantId: user.tenantId._id,
    email: user.email,
    deviceId,
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      tenant: {
        id: user.tenantId._id,
        name: user.tenantId.name,
        slug: user.tenantId.slug,
        plan: user.tenantId.plan,
      },
    },
  };
}

// ─── Refresh access token ─────────────────────────────────────────────────────
async function refreshAccessToken({ refreshToken, ip, userAgent }) {
  if (!refreshToken) {
    throw new AuthenticationError('Refresh token required');
  }

  // Find user with this refresh token
  const user = await User.findOne({
    'refreshTokens.token': refreshToken,
    isActive: true,
  }).select('+refreshTokens');

  if (!user) {
    throw new AuthenticationError('Invalid or expired refresh token');
  }

  const storedToken = user.refreshTokens.find((rt) => rt.token === refreshToken);

  if (!storedToken || storedToken.expiresAt < new Date()) {
    // Remove expired token
    user.refreshTokens = user.refreshTokens.filter((rt) => rt.token !== refreshToken);
    await user.save();
    throw new AuthenticationError('Refresh token expired — please log in again');
  }

  // Rotate refresh token
  const { token: newRefreshToken, expiresAt } = generateRefreshToken(user);
  const { token: newAccessToken } = generateAccessToken(user);

  // Replace old with new
  storedToken.token = newRefreshToken;
  storedToken.expiresAt = expiresAt;
  storedToken.ip = ip;
  storedToken.userAgent = userAgent;

  await user.save();

  logger.info('Access token refreshed', {
    userId: user._id,
    tenantId: user.tenantId,
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout({ userId, refreshToken, jti }) {
  try {
    // Blacklist the current access token JTI in Redis (until it expires)
    const redis = getRedisClient();
    if (redis && jti) {
      const accessTokenTTL = 15 * 60; // 15 minutes in seconds
      await redis.setex(KEYS.sessionBlacklist(jti), accessTokenTTL, '1');
    }

    // Remove the specific refresh token
    await User.updateOne({ _id: userId }, { $pull: { refreshTokens: { token: refreshToken } } });

    logger.info('User logged out', { userId });
  } catch (err) {
    logger.error('Logout error', { error: err.message, userId });
  }
}

// ─── Logout all devices ───────────────────────────────────────────────────────
async function logoutAllDevices(userId) {
  await User.updateOne({ _id: userId }, { $set: { refreshTokens: [] } });
  logger.info('User logged out from all devices', { userId });
}

// ─── Get current user ─────────────────────────────────────────────────────────
async function getMe(userId) {
  const user = await User.findById(userId).populate('tenantId', 'name slug plan settings');

  if (!user) throw new NotFoundError('User');

  return user;
}

// ─── Change password ──────────────────────────────────────────────────────────
async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash');

  if (!user) throw new NotFoundError('User');

  const isValid = await user.comparePassword(currentPassword);
  if (!isValid) throw new AuthenticationError('Current password is incorrect');

  if (newPassword.length < 8) {
    throw new ValidationError('New password must be at least 8 characters');
  }

  user.passwordHash = newPassword;
  user.passwordChangedAt = new Date();
  user.refreshTokens = []; // Invalidate all sessions on password change
  await user.save();

  logger.info('Password changed', { userId });
}

module.exports = {
  register,
  login,
  refreshAccessToken,
  logout,
  logoutAllDevices,
  getMe,
  changePassword,
};
