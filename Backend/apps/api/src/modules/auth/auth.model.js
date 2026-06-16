'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── Tenant Schema ────────────────────────────────────────────────────────────
const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]+$/,
    },
    plan: {
      type: String,
      enum: ['starter', 'pro', 'enterprise'],
      default: 'starter',
    },
    settings: {
      maxAgents: { type: Number, default: 3 },
      maxWorkflows: { type: Number, default: 10 },
      maxUsersPerTenant: { type: Number, default: 10 },
      allowedIntegrations: {
        type: [String],
        default: ['slack', 'jira'],
      },
      aiCostLimitUSD: { type: Number, default: 100 },
    },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'tenants',
  }
);

tenantSchema.index({ slug: 1 }, { unique: true });

// ─── User Schema ──────────────────────────────────────────────────────────────
const refreshTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true },
    deviceId: { type: String, default: 'unknown' },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    role: {
      type: String,
      enum: ['admin', 'manager', 'analyst', 'viewer'],
      default: 'analyst',
    },
    avatar: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    isEmailVerified: { type: Boolean, default: false },
    refreshTokens: {
      type: [refreshTokenSchema],
      default: [],
      select: false,
    },
    lastLoginAt: { type: Date, default: null },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// ─── Compound unique index — email per tenant ──────────────────────────────────
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, role: 1 });

// ─── Virtual: full name ────────────────────────────────────────────────────────
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// ─── Virtual: account locked ──────────────────────────────────────────────────
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ─── Pre-save: hash password ───────────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

// ─── Instance method: compare password ────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// ─── Instance method: increment login attempts (brute-force protection) ────────
const LOCK_AFTER_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

userSchema.methods.incrementLoginAttempts = async function () {
  // Reset if lock has expired
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }

  const update = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= LOCK_AFTER_ATTEMPTS && !this.isLocked) {
    update.$set = { lockUntil: new Date(Date.now() + LOCK_DURATION_MS) };
  }

  return this.updateOne(update);
};

// ─── Instance method: clear login attempts on success ─────────────────────────
userSchema.methods.clearLoginAttempts = async function () {
  return this.updateOne({
    $set: { loginAttempts: 0, lastLoginAt: new Date() },
    $unset: { lockUntil: 1 },
  });
};

// ─── Instance method: clean expired refresh tokens ────────────────────────────
userSchema.methods.cleanExpiredTokens = function () {
  this.refreshTokens = this.refreshTokens.filter((rt) => rt.expiresAt > new Date());
};

// ─── toJSON — strip sensitive fields ──────────────────────────────────────────
userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.refreshTokens;
    delete ret.__v;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);
const Tenant = mongoose.model('Tenant', tenantSchema);

module.exports = { User, Tenant };

