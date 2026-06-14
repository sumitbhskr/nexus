'use strict';

const express = require('express');
const router = express.Router();

const authController = require('./auth.controller');
const { authenticate } = require('../../common/middleware/auth');
const { authLimiter } = require('../../common/middleware/rateLimiter');
const { auditLog } = require('../../common/middleware/auditLog');

// ─── Public routes (rate limited) ────────────────────────────────────────────
router.post('/register', authLimiter, auditLog('USER_REGISTER', 'auth'), authController.register);
router.post('/login', authLimiter, auditLog('USER_LOGIN', 'auth'), authController.login);
router.post('/refresh', authLimiter, authController.refresh);

// ─── Protected routes ─────────────────────────────────────────────────────────
router.use(authenticate);

router.get('/me', authController.getMe);
router.delete('/logout', auditLog('USER_LOGOUT', 'auth'), authController.logout);
router.delete('/logout-all', auditLog('USER_LOGOUT_ALL', 'auth'), authController.logoutAll);
router.patch(
  '/change-password',
  auditLog('PASSWORD_CHANGE', 'auth'),
  authController.changePassword
);

module.exports = router;