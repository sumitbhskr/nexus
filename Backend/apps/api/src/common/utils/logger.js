'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const LOG_DIR = path.join(process.cwd(), 'logs');

// ─── Console format (dev only) ────────────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, requestId, tenantId, ...meta }) => {
    const rid = requestId ? ` [${requestId}]` : '';
    const tid = tenantId ? ` [T:${tenantId}]` : '';
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp}${rid}${tid} ${level}: ${message}${metaStr}`;
  })
);

// ─── JSON format (production) ─────────────────────────────────
const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const isDev = process.env.NODE_ENV !== 'production';

const transports = [
  new winston.transports.Console({
    format: isDev ? devFormat : prodFormat,
    silent: process.env.NODE_ENV === 'test',
  }),
];

// Add file transports in production
if (!isDev) {
  transports.push(
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
      maxSize: '20m',
      format: prodFormat,
    }),
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '50m',
      format: prodFormat,
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  defaultMeta: {
    service: process.env.OTEL_SERVICE_NAME || 'nexus-api',
    environment: process.env.NODE_ENV,
  },
  transports,
  exitOnError: false,
});

module.exports = logger;
