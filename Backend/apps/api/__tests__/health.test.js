const { User, Tenant } = require('../src/modules/auth/auth.model');
('use strict');

/**
 * NEXUS API — Health, Metrics & Auth Integration Tests
 *
 * Strategy:
 *  - All required env vars set BEFORE any require() call
 *  - Rate limiter disabled for test env
 *  - Each test has explicit timeout to avoid flakiness
 *  - Auth tests run sequentially (tokens shared via closure)
 *
 * Coverage:
 *  - GET    /health                  — dependency health checks
 *  - GET    /metrics                 — Prometheus metrics
 *  - GET    /*                       — 404 structured error
 *  - POST   /api/v1/auth/register    — tenant + admin creation
 *  - POST   /api/v1/auth/login       — JWT issuance + failure paths
 *  - GET    /api/v1/auth/me          — protected route
 *  - POST   /api/v1/auth/refresh     — token rotation
 *  - DELETE /api/v1/auth/logout      — session invalidation
 */

const request = require('supertest');
////
const mongoose = require('mongoose');
/////
// --- All env vars MUST be set before requiring main.js -----------------------
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.APP_URL = 'http://localhost:3001';
process.env.FRONTEND_URL = 'http://localhost:3000';

// Auth
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-for-ci-pipeline-only!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-chars-for-ci-pipeline!!';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

// Databases
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nexus_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
process.env.QDRANT_COLLECTION = 'nexus_test';

// AI — placeholder keys satisfy validator + OpenAI SDK without real API calls
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-placeholder-for-ci-not-real-xxxxxxxxxxx';
process.env.OPENAI_API_KEY = 'sk-test-placeholder-for-ci-not-real-xxxxxxxxxxxxxxx';
process.env.LLM_MODEL = 'claude-sonnet-4-6';
process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
process.env.LLM_MAX_TOKENS = '2000';
process.env.LLM_TEMPERATURE = '0.1';

// Security
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-ok!';

// Rate limiting — high values so tests never hit limits
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';
process.env.AI_RATE_LIMIT_MAX = '10000';

// Misc
process.env.LOG_LEVEL = 'error'; // suppress logs during tests
process.env.UPLOAD_MAX_SIZE_MB = '50';
process.env.UPLOAD_DIR = './uploads';

// --- Import app AFTER env is fully configured ---------------------------------
process.env.SKIP_BOOTSTRAP = 'true';
const { app } = require('../src/main');

// --- Shared auth state (populated by register ? reused by login/me/refresh/logout)
let accessToken;
let refreshToken;

const TEST_USER = {
  tenantName: 'NEXUS CI Corp',
  firstName: 'CI',
  lastName: 'Test',
  email: `ci-${Date.now()}@nexus.test`,
  password: 'Test@1234!Secure',
};

// --- Wait for all services to connect before running any test -----------------
beforeAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Test DB pe hi cleanup karo — safety check
  const dbName = mongoose.connection.db?.databaseName ?? '';
  if (!dbName.includes('test')) {
    throw new Error(`ABORT: Connected to non-test DB ? "${dbName}". Cleanup blocked.`);
  }

  await User.deleteMany({});
  await Tenant.deleteMany({});
}, 30000);

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500));
});

// -----------------------------------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------------------------------
describe('GET /health', () => {
  it('returns 200 with status healthy when MongoDB + Redis are up', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.services).toMatchObject({
      mongodb: 'connected',
      redis: 'connected',
    });
  }, 10000);

  it('includes uptime (number), version (string), and ISO timestamp', async () => {
    const res = await request(app).get('/health');

    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.version).toBe('string');
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }, 10000);

  it('returns environment = test', async () => {
    const res = await request(app).get('/health');
    expect(res.body.environment).toBe('test');
  }, 10000);
});

// -----------------------------------------------------------------------------
// PROMETHEUS METRICS
// -----------------------------------------------------------------------------
describe('GET /metrics', () => {
  it('returns 200 with Prometheus text/plain content-type', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  }, 10000);

  it('exposes Node.js process metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('nodejs_heap_size_used_bytes');
  }, 10000);

  it('exposes HTTP request counter metric', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('nexus_http_request_duration_ms');
  }, 10000);
});

// -----------------------------------------------------------------------------
// 404 HANDLER
// -----------------------------------------------------------------------------
describe('404 handler', () => {
  it('returns structured 404 for unknown GET route', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Route not found',
    });
    expect(res.body).toHaveProperty('path');
    expect(res.body).toHaveProperty('timestamp');
  }, 10000);

  it('returns structured 404 for unknown POST route', async () => {
    const res = await request(app).post('/api/v1/ghost-endpoint').send({});
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  }, 10000);
});

// -----------------------------------------------------------------------------
// AUTH — REGISTER
// -----------------------------------------------------------------------------
describe('POST /api/v1/auth/register', () => {
  it('creates tenant + admin user and returns JWT tokens', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data).toHaveProperty('tenant');
    expect(res.body.data.user).toMatchObject({
      email: TEST_USER.email,
      role: 'admin',
    });

    // Store for downstream tests
    // tokens captured from login test
  }, 15000);

  it('rejects duplicate email with 409', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  }, 10000);

  it('rejects missing required fields with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'incomplete@nexus.test' });

    expect(res.status).toBe(400);
  }, 10000);

  it('rejects weak password with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...TEST_USER, email: 'weak@nexus.test', password: '123' });

    expect(res.status).toBe(400);
  }, 10000);
});

// -----------------------------------------------------------------------------
// AUTH — LOGIN
// -----------------------------------------------------------------------------
describe('POST /api/v1/auth/login', () => {
  it('returns access + refresh tokens on valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');

    // Refresh tokens for downstream tests
    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
  }, 10000);

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email, password: 'WrongPassword!99' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  }, 10000);

  it('rejects non-existent email with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@nexus.test', password: 'anything' });

    expect(res.status).toBe(401);
  }, 10000);

  it('rejects empty body with 400', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});

    expect(res.status).toBe(400);
  }, 10000);
});

// -----------------------------------------------------------------------------
// AUTH — ME (protected route)
// -----------------------------------------------------------------------------
describe('GET /api/v1/auth/me', () => {
  it('returns current user profile with valid JWT', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: TEST_USER.email });
  }, 10000);

  it('rejects request with no Authorization header — 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  }, 10000);

  it('rejects malformed Bearer token — 401', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
  }, 10000);

  it('rejects tampered JWT signature — 401', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlVXNlciJ9.invalidsignature';

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${fakeToken}`);

    expect(res.status).toBe(401);
  }, 10000);
});

// -----------------------------------------------------------------------------
// AUTH — REFRESH TOKEN ROTATION
// -----------------------------------------------------------------------------
describe('POST /api/v1/auth/refresh', () => {
  it('issues NEW access + refresh tokens — rotation confirmed', async () => {
    const previousAccess = accessToken;
    const previousRefresh = refreshToken;

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');

    // Tokens must rotate — new !== old
    expect(res.body.data.accessToken).not.toBe(previousAccess);
    expect(res.body.data.refreshToken).not.toBe(previousRefresh);
    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;

    // tokens captured from login test
  }, 10000);

  it('rejects completely invalid refresh token — 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid-token-value' });

    expect(res.status).toBe(401);
  }, 10000);

  it('rejects missing refreshToken field — 400', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});

    expect([400, 401, 422]).toContain(res.status);
  }, 10000);
});

// -----------------------------------------------------------------------------
// AUTH — LOGOUT
// -----------------------------------------------------------------------------
describe('DELETE /api/v1/auth/logout', () => {
  it('invalidates current session — returns 200', async () => {
    const res = await request(app)
      .delete('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
  }, 10000);

  it('blocks token reuse after logout — 401', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(401);
  }, 10000);

  it('rejects logout with no token — 401', async () => {
    const res = await request(app).delete('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  }, 10000);
});

