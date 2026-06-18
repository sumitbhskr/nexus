// 'use strict';

// const express = require('express');
// const router = express.Router();

// const authController = require('./auth.controller');
// const { authenticate } = require('../../common/middleware/auth');
// const { authLimiter } = require('../../common/middleware/rateLimiter');
// const { auditLog } = require('../../common/middleware/auditLog');

// // ─── Public routes (rate limited) ────────────────────────────────────────────
// router.post('/register', authLimiter, auditLog('USER_REGISTER', 'auth'), authController.register);
// router.post('/login', authLimiter, auditLog('USER_LOGIN', 'auth'), authController.login);
// router.post('/refresh', authLimiter, authController.refresh);

// // ─── Protected routes ─────────────────────────────────────────────────────────
// router.use(authenticate);

// router.get('/me', authController.getMe);
// router.delete('/logout', auditLog('USER_LOGOUT', 'auth'), authController.logout);
// router.delete('/logout-all', auditLog('USER_LOGOUT_ALL', 'auth'), authController.logoutAll);
// router.patch(
//   '/change-password',
//   auditLog('PASSWORD_CHANGE', 'auth'),
//   authController.changePassword
// );

// module.exports = router;

/////
'use strict';

const express = require('express');
const router = express.Router();

const authController = require('./auth.controller');
const { authenticate } = require('../../common/middleware/auth');
const { authLimiter } = require('../../common/middleware/rateLimiter');
const { auditLog } = require('../../common/middleware/auditLog');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication endpoints
 *
 * /api/v1/auth/register:
 *   post:
 *     summary: Register new tenant and admin user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, tenantName]
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@company.com
 *               password:
 *                 type: string
 *                 example: StrongPass@123
 *               tenantName:
 *                 type: string
 *                 example: My Company
 *     responses:
 *       201:
 *         description: Tenant and admin created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already exists
 *
 * /api/v1/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@company.com
 *               password:
 *                 type: string
 *                 example: StrongPass@123
 *     responses:
 *       200:
 *         description: Login successful, returns JWT tokens
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid credentials
 *
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access and refresh tokens
 *       400:
 *         description: Missing refreshToken
 *       401:
 *         description: Invalid or expired refresh token
 *
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *       401:
 *         description: Unauthorized
 *
 * /api/v1/auth/logout:
 *   delete:
 *     summary: Logout and invalidate current session
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Unauthorized
 *
 * /api/v1/auth/logout-all:
 *   delete:
 *     summary: Logout from all devices
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out from all devices
 *       401:
 *         description: Unauthorized
 *
 * /api/v1/auth/change-password:
 *   patch:
 *     summary: Change current user password
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       401:
 *         description: Unauthorized or wrong current password
 */

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
