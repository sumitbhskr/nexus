'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../common/utils/logger');

let io = null;

function initSocketIO(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ─── Auth middleware for Socket.IO ──────────────────────────
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.tenantId = decoded.tenantId;
      socket.role = decoded.role;
      next();
    } catch (err) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, tenantId } = socket;

    logger.info('WebSocket client connected', { userId, tenantId, socketId: socket.id });

    // Join tenant room (multi-tenant isolation)
    socket.join(`tenant:${tenantId}`);
    socket.join(`user:${userId}`);

    socket.on('subscribe:agents', () => {
      socket.join(`agents:${tenantId}`);
    });

    socket.on('subscribe:incidents', () => {
      socket.join(`incidents:${tenantId}`);
    });

    socket.on('subscribe:workflow', (workflowId) => {
      socket.join(`workflow:${workflowId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info('WebSocket client disconnected', { userId, reason });
    });

    socket.on('error', (error) => {
      logger.error('WebSocket error', { userId, error: error.message });
    });
  });

  logger.info('Socket.IO server initialized');
  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}

// ─── Emit helpers ─────────────────────────────────────────────
function emitToTenant(tenantId, event, data) {
  if (!io) return;
  io.to(`tenant:${tenantId}`).emit(event, {
    ...data,
    timestamp: new Date().toISOString(),
  });
}

function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, {
    ...data,
    timestamp: new Date().toISOString(),
  });
}

function emitAgentUpdate(tenantId, agentData) {
  emitToTenant(tenantId, 'agent:update', agentData);
}

function emitIncidentUpdate(tenantId, incident) {
  emitToTenant(tenantId, 'incident:update', incident);
}

function emitWorkflowUpdate(workflowId, update) {
  if (!io) return;
  io.to(`workflow:${workflowId}`).emit('workflow:update', {
    ...update,
    timestamp: new Date().toISOString(),
  });
}

function emitApprovalRequest(tenantId, approval) {
  emitToTenant(tenantId, 'approval:new', approval);
}

module.exports = {
  initSocketIO,
  getIO,
  emitToTenant,
  emitToUser,
  emitAgentUpdate,
  emitIncidentUpdate,
  emitWorkflowUpdate,
  emitApprovalRequest,
};
