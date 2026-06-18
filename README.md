# NEXUS — Enterprise Decision Intelligence Platform

<div align="center">

![NEXUS](https://img.shields.io/badge/NEXUS-Enterprise%20AI-6C3DF4?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=next.js)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=for-the-badge&logo=mongodb)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker)
![Jest](https://img.shields.io/badge/Jest-26%2F26%20Tests-C21325?style=for-the-badge&logo=jest)
![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions)
![Swagger](https://img.shields.io/badge/Swagger-OpenAPI%203.0-85EA2D?style=for-the-badge&logo=swagger)
![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-E6522C?style=for-the-badge&logo=prometheus)
![Grafana](https://img.shields.io/badge/Grafana-Dashboards-F46800?style=for-the-badge&logo=grafana)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**A production-grade, multi-tenant SaaS platform that unifies AI agents, automated workflows, RAG-based knowledge retrieval, and third-party SaaS integrations into a single operational command center — with full observability, CI/CD, and live API documentation.**

[Features](#features) • [Architecture](#architecture-overview) • [Tech Stack](#tech-stack) • [Getting Started](#getting-started) • [Running Locally](#running-locally) • [API Reference](#api-reference) • [Swagger Docs](#swagger--api-docs) • [Monitoring](#monitoring--observability) • [CI/CD](#cicd-pipeline) • [Security](#security) • [Troubleshooting](#troubleshooting) • [Roadmap](#roadmap)

</div>

---

## What is NEXUS?

NEXUS is a production-ready, multi-tenant enterprise platform that lets organizations:

- **Run AI Agents** — LangChain/LangGraph-powered agents that reason, call tools, and trigger workflows
- **Automate Workflows** — Multi-step business process automation with scheduling and human-in-the-loop approval gates
- **Search with RAG** — OpenAI-embedding-based document retrieval via Qdrant vector database
- **Integrate SaaS Tools** — Salesforce, Jira, Slack, Zendesk via a unified BaseConnector pattern
- **Monitor Everything** — Real-time Grafana dashboards powered by Prometheus metrics and OpenTelemetry tracing
- **Ship with Confidence** — Full CI/CD via GitHub Actions, 26/26 Jest integration tests, Swagger/OpenAPI docs

---

## Features

| Feature | Description |
|---|---|
| **Multi-Tenant Auth** | JWT access + refresh token rotation, RBAC, per-tenant data isolation |
| **AI Agents** | LangChain/LangGraph agents with tool-calling, OpenTelemetry traced |
| **Workflow Engine** | Multi-step automations with cron scheduling and human-in-the-loop approvals |
| **RAG Pipeline** | Document ingestion → OpenAI embeddings → Qdrant → context-aware agent prompts |
| **SaaS Integrations** | Connector pattern: Salesforce, Jira, Slack, Zendesk |
| **Real-time Updates** | Socket.IO pushes live agent/workflow/approval status to dashboard |
| **Event Bus** | Internal pub/sub decouples module-to-module communication |
| **Swagger Docs** | Auto-generated OpenAPI 3.0 docs at `/api/docs` (non-production) |
| **CI/CD Pipeline** | GitHub Actions: lint + test + build + Docker Compose validation on every push |
| **Jest Test Suite** | 26/26 integration tests — auth, health, metrics, 404 handler |
| **Observability** | Prometheus metrics, Grafana dashboards, OpenTelemetry tracing, Winston JSON logs |
| **Security** | Helmet, CORS, rate limiting, AES-256 credential encryption, audit logs, account lockout |
| **Containerized** | Multi-stage Docker builds, non-root containers, full Docker Compose stack |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NEXUS Platform                               │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │              Next.js 14 Frontend (Port 3000)                 │  │
│   │         Dashboard · Login · Agents · Approvals               │  │
│   └─────────────────────────┬────────────────────────────────────┘  │
│                             │  REST API + WebSocket (Socket.IO)      │
│   ┌─────────────────────────▼────────────────────────────────────┐  │
│   │              Express API Server (Port 3001)                   │  │
│   │                                                               │  │
│   │   ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────┐   │  │
│   │   │   Auth   │ │  Agents  │ │ Workflows │ │  Approvals  │   │  │
│   │   └──────────┘ └──────────┘ └───────────┘ └─────────────┘   │  │
│   │   ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────┐   │  │
│   │   │   RAG    │ │  Events  │ │  Webhook  │ │ Observabil. │   │  │
│   │   └──────────┘ └──────────┘ └───────────┘ └─────────────┘   │  │
│   │                                                               │  │
│   │              Integrations Layer (BaseConnector Pattern)       │  │
│   │   ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────┐   │  │
│   │   │Salesforce│ │   Jira   │ │   Slack   │ │   Zendesk   │   │  │
│   │   └──────────┘ └──────────┘ └───────────┘ └─────────────┘   │  │
│   └─────┬──────────────┬──────────────────┬────────────────────┘  │
│         │              │                  │                         │
│   ┌─────▼──────┐ ┌─────▼──────┐   ┌──────▼──────┐                 │
│   │  MongoDB 7  │ │  Redis 7   │   │   Qdrant    │                 │
│   │ (Primary DB)│ │(Cache/Queue│   │(Vector Store│                 │
│   └────────────┘ └────────────┘   └─────────────┘                 │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │              Observability Stack                             │  │
│   │   prom-client → Prometheus (9090) → Grafana (3003)          │  │
│   │   OpenTelemetry → OTLP Exporter → Distributed Tracing       │  │
│   │   Winston → Structured JSON Logs → Daily Rotation           │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │              CI/CD Pipeline (GitHub Actions)                 │  │
│   │   Push → Backend Lint + Test → Frontend Lint + Build        │  │
│   │        → Docker Compose Validate → All Green ✅              │  │
│   └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## System Design & Core Flows

### 1. Authentication Flow

```
Client → POST /api/v1/auth/register
       → Creates Tenant + Admin User
       → Returns JWT access token (15m) + refresh token (7d)

Client → POST /api/v1/auth/login
       → Validates email + bcrypt password
       → Checks tenant.isActive
       → Returns tokens + user profile

Client → POST /api/v1/auth/refresh
       → Validates refresh token (stored in DB, rotated on use)
       → Returns new access + refresh token pair

Client → DELETE /api/v1/auth/logout
       → Blacklists current session JTI in Redis
       → Token reuse blocked immediately
```

### 2. Agent Execution Flow

```
Client → POST /api/v1/agents/:id/run
       → agentRunner.js initializes LangChain agent
       → Agent calls tools (integrations, RAG, workflows)
       → Each step traced via OpenTelemetry
       → Results pushed to client via Socket.IO
       → Stored in MongoDB for audit trail
```

### 3. RAG Pipeline Flow

```
Document Upload → rag.service.js
               → Chunked + embedded via OpenAI text-embedding-3-small
               → Stored in Qdrant (nexus_embeddings collection)
               → Indexed by tenantId, source, documentId

Agent Query → rag.service.js retrieves top-k similar chunks
           → Context injected into agent system prompt
           → Agent responds with grounded knowledge
```

### 4. Webhook Flow

```
External Service → POST /api/v1/webhooks/:provider
                → Raw body preserved for HMAC signature verification
                → Parsed + dispatched to relevant integration handler
                → eventBus.publish() notifies internal modules
```

---

## Tech Stack

### Backend (`Backend/apps/api`)

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20 | Runtime |
| Express | 4.x | HTTP framework |
| MongoDB + Mongoose | 7 | Primary data store |
| Redis | 7 | Caching, session store, Bull queues |
| Qdrant | 1.x | Vector database for RAG |
| Socket.IO | 4.x | Real-time bidirectional events |
| LangChain / LangGraph | latest | AI agent orchestration |
| Anthropic SDK | latest | Claude model integration |
| OpenAI SDK | latest | GPT + embedding models |
| swagger-jsdoc | 6.x | OpenAPI spec generation from JSDoc |
| swagger-ui-express | 5.x | Swagger UI at `/api/docs` |
| prom-client | latest | Prometheus metrics |
| OpenTelemetry | latest | Distributed tracing |
| Winston | 3.x | Structured JSON logging |
| JWT | 9.x | Stateless authentication |
| bcrypt | 5.x | Password hashing |
| Helmet | 7.x | Security headers |
| express-rate-limit | 7.x | API rate limiting |
| Jest + Supertest | 29.x | Integration test suite (26/26 passing) |

### Frontend (`apps/web`)

| Technology | Version | Purpose |
|---|---|---|
| Next.js | 14 | React framework (App Router) |
| TypeScript | 5.x | Type safety |
| TanStack React Query | 5.x | Server state management |
| Zustand | 4.x | Client state management |
| Tailwind CSS | 3.x | Utility-first styling |

### Infrastructure

| Tool | Purpose |
|---|---|
| Docker + Docker Compose | Containerization, local dev stack |
| GitHub Actions | CI/CD — lint, test, build, Docker validation |
| Prometheus | Metrics collection |
| Grafana | Metrics visualization |
| Multi-stage Dockerfile | Optimized production images, non-root user |

---

## Project Structure

```
nexus/
├── .github/
│   └── workflows/
│       └── ci.yml                        # GitHub Actions CI/CD pipeline
├── Backend/
│   └── apps/
│       └── api/
│           ├── Dockerfile                # Multi-stage build, non-root container
│           ├── package.json
│           ├── jest.setup.env.js         # Jest env loader for local test runs
│           └── src/
│               ├── main.js               # App entrypoint, bootstrap, graceful shutdown
│               ├── common/
│               │   ├── metrics.js        # prom-client Prometheus metrics
│               │   ├── middleware/
│               │   │   ├── auth.js       # JWT verification middleware
│               │   │   ├── auditLog.js   # Audit trail middleware
│               │   │   ├── errorHandler.js
│               │   │   ├── rateLimiter.js
│               │   │   └── requestLogger.js
│               │   └── utils/
│               │       └── logger.js     # Winston JSON logger + daily rotate
│               ├── config/
│               │   ├── database.js       # MongoDB connection + health
│               │   ├── env.validator.js  # Fail-fast env validation
│               │   ├── qdrant.js         # Qdrant vector DB client
│               │   ├── redis.js          # ioredis client + pub/sub
│               │   ├── socket.js         # Socket.IO server init
│               │   └── swagger.js        # OpenAPI 3.0 spec config
│               └── modules/
│                   ├── agents/           # LangChain agent runner + tools
│                   ├── approvals/        # Human-in-the-loop approval flows
│                   ├── auth/             # JWT auth, RBAC, session management
│                   ├── dashboard/        # Aggregated metrics endpoint
│                   ├── events/           # Internal pub/sub event bus
│                   ├── integrations/     # BaseConnector + Salesforce/Jira/Slack/Zendesk
│                   ├── observability/    # OpenTelemetry tracer + routes
│                   ├── rag/              # Document ingestion + vector search
│                   └── workflows/        # Workflow engine + scheduler
├── apps/
│   └── web/                             # Next.js 14 frontend
│       ├── Dockerfile
│       └── src/
├── infra/
│   ├── docker/
│   │   └── docker-compose.prod.yml      # Production compose
│   └── prometheus/
│       └── prometheus.yml               # Scrape config
├── docker-compose.yml                   # Local dev full stack
├── .env.example                         # Environment variable template
├── .gitignore                           # Includes .env, .env.test, node_modules
└── package.json                         # Monorepo root (npm workspaces)
```

---

## Getting Started

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | >= 20 | [nodejs.org](https://nodejs.org) |
| npm | >= 10 | Bundled with Node.js |
| Docker Desktop | latest | [docker.com](https://www.docker.com/products/docker-desktop) |
| Git | latest | [git-scm.com](https://git-scm.com) |

### 1. Clone the Repository

```bash
git clone https://github.com/sumitbhskr/nexus.git
cd nexus
```

### 2. Setup Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your values — see [Environment Variables](#environment-variables) section below.

### 3. Install Dependencies

```bash
# Install all workspace dependencies
npm install

# Or install per workspace
cd Backend/apps/api && npm install
cd apps/web && npm install
```

---

## Running Locally

### Option A — Docker Full Stack (Recommended)

Starts all services: MongoDB, Redis, Qdrant, Prometheus, Grafana.

```bash
cd nexus
docker-compose up -d
```

Then start the API and frontend separately for hot reload:

```bash
# Terminal 1 — API
cd Backend/apps/api
npm run dev

# Terminal 2 — Frontend
cd apps/web
npm run dev
```

### Option B — Partial Docker (MongoDB + Redis only)

```bash
# Start only infrastructure services
docker-compose up -d mongodb redis

# Terminal 1 — API (set REDIS_URL with password)
cd Backend/apps/api
$env:REDIS_URL="redis://:YOUR_REDIS_PASSWORD@localhost:6379"  # PowerShell
# export REDIS_URL="redis://:YOUR_REDIS_PASSWORD@localhost:6379"  # bash/zsh
npm run dev

# Terminal 2 — Frontend
cd apps/web
npm run dev
```

### Stopping Services

```bash
# Stop API/Frontend — Ctrl+C in each terminal

# Stop Docker services
docker-compose down

# Stop + remove volumes (clean slate)
docker-compose down --volumes
```

---

## Service URLs

| Service | URL | Credentials |
|---|---|---|
| **API Server** | http://localhost:3001 | — |
| **Swagger Docs** | http://localhost:3001/api/docs | — |
| **Health Check** | http://localhost:3001/health | — |
| **Prometheus Metrics** | http://localhost:3001/metrics | — |
| **Frontend** | http://localhost:3000 | — |
| **Prometheus UI** | http://localhost:9090 | — |
| **Grafana** | http://localhost:3003 | admin / `GRAFANA_PASSWORD` |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
# ─── App ──────────────────────────────────────────────
NODE_ENV=development
PORT=3001
APP_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000

# ─── MongoDB ──────────────────────────────────────────
MONGODB_URI=mongodb://nexus:nexus_dev_password@localhost:27017/nexus?authSource=admin
MONGO_ROOT_USER=nexus
MONGO_ROOT_PASSWORD=nexus_dev_password

# ─── Redis ────────────────────────────────────────────
REDIS_PASSWORD=nexus_redis_password
REDIS_URL=redis://:nexus_redis_password@localhost:6379

# ─── JWT ──────────────────────────────────────────────
JWT_SECRET=your_jwt_secret_min_32_chars
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ─── AI / LLM ─────────────────────────────────────────
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# ─── Qdrant ───────────────────────────────────────────
QDRANT_URL=http://localhost:6333

# ─── Encryption ───────────────────────────────────────
ENCRYPTION_KEY=your_32_char_aes_key

# ─── Rate Limiting ────────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ─── Grafana ──────────────────────────────────────────
GRAFANA_PASSWORD=nexus_grafana
```

> **Never commit `.env` or `.env.test`** — both are in `.gitignore`. Only `.env.example` is tracked.

---

## Running Tests

```bash
cd Backend/apps/api

# Run all tests with coverage
npm test

# Watch mode (local development)
npm run test:watch
```

**Current test results:**

```
Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total

Coverage:
  modules/auth  → 79% statements, 81% lines ✅
```

**Test coverage includes:**

| Suite | Tests |
|---|---|
| `GET /health` | MongoDB + Redis up, uptime, version, environment |
| `GET /metrics` | Prometheus format, Node.js metrics, HTTP counter |
| `404 handler` | Unknown GET + POST routes |
| `POST /api/v1/auth/register` | Success, duplicate email, missing fields, weak password |
| `POST /api/v1/auth/login` | Success, wrong password, non-existent email, empty body |
| `GET /api/v1/auth/me` | Valid JWT, no header, malformed token, tampered signature |
| `POST /api/v1/auth/refresh` | Token rotation, invalid token, missing field |
| `DELETE /api/v1/auth/logout` | Success, token reuse blocked, no token |

---

## Swagger / API Docs

Auto-generated OpenAPI 3.0 documentation available at:

```
http://localhost:3001/api/docs
```

> Available in `development` and `test` environments only. Disabled in `production`.

**JSON spec endpoint:**

```
http://localhost:3001/api/docs.json
```

Currently documented: **Auth module** (register, login, refresh, me, logout, logout-all, change-password)

---

## API Reference

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | None | Create tenant + admin user |
| POST | `/api/v1/auth/login` | None | Login, returns JWT tokens |
| POST | `/api/v1/auth/refresh` | None | Rotate access + refresh tokens |
| GET | `/api/v1/auth/me` | JWT | Get current user profile |
| DELETE | `/api/v1/auth/logout` | JWT | Invalidate current session |
| DELETE | `/api/v1/auth/logout-all` | JWT | Invalidate all sessions |
| PATCH | `/api/v1/auth/change-password` | JWT | Change password |

### Agents

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/agents` | JWT | List all agents |
| POST | `/api/v1/agents` | JWT | Create agent |
| GET | `/api/v1/agents/:id` | JWT | Get agent by ID |
| PUT | `/api/v1/agents/:id` | JWT | Update agent |
| DELETE | `/api/v1/agents/:id` | JWT | Delete agent |
| POST | `/api/v1/agents/:id/run` | JWT | Execute agent |

### Workflows

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/workflows` | JWT | List workflows |
| POST | `/api/v1/workflows` | JWT | Create workflow |
| GET | `/api/v1/workflows/:id` | JWT | Get workflow |
| PUT | `/api/v1/workflows/:id` | JWT | Update workflow |
| DELETE | `/api/v1/workflows/:id` | JWT | Delete workflow |
| POST | `/api/v1/workflows/:id/trigger` | JWT | Manually trigger workflow |
| GET | `/api/v1/workflows/:id/runs` | JWT | Get run history |

### Approvals

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/approvals` | JWT | List pending approvals |
| POST | `/api/v1/approvals/:id/approve` | JWT | Approve |
| POST | `/api/v1/approvals/:id/reject` | JWT | Reject |

### Integrations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/integrations` | JWT | List connected integrations |
| POST | `/api/v1/integrations/:provider/connect` | JWT | Connect SaaS integration |
| DELETE | `/api/v1/integrations/:provider` | JWT | Disconnect integration |
| POST | `/api/v1/webhooks/:provider` | HMAC | Receive provider webhook |

### RAG

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/rag/ingest` | JWT | Upload + embed document |
| POST | `/api/v1/rag/query` | JWT | Semantic search |
| DELETE | `/api/v1/rag/:documentId` | JWT | Delete document embeddings |

### System

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | MongoDB + Redis health check |
| GET | `/metrics` | None | Prometheus metrics |
| GET | `/api/docs` | None | Swagger UI (non-production) |
| GET | `/api/docs.json` | None | OpenAPI JSON spec (non-production) |

---

## CI/CD Pipeline

GitHub Actions runs automatically on every `push` to any branch.

**Workflow file:** `.github/workflows/ci.yml`

```
Push to GitHub
    │
    ├── Backend — Lint + Test (Node 20, MongoDB service container)
    │       npm ci → eslint → jest --coverage --forceExit
    │
    ├── Frontend — Lint + Build (Node 20)
    │       npm ci → next lint → next build
    │
    └── Docker — Validate Compose
            docker-compose config --quiet
```

**All three jobs must pass before merge.**

View runs: [github.com/sumitbhskr/nexus/actions](https://github.com/sumitbhskr/nexus/actions)

---

## Monitoring & Observability

### Health Check (`/health`)

```json
{
  "status": "healthy",
  "timestamp": "2026-06-18T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 3600,
  "services": {
    "mongodb": "connected",
    "redis": "connected"
  },
  "environment": "development"
}
```

### Metrics (`/metrics`)

Prometheus-format metrics via `prom-client`:

```
# Node.js process metrics
process_cpu_user_seconds_total
nodejs_heap_size_used_bytes
nodejs_event_loop_lag_seconds
nodejs_active_handles_total

# HTTP request metrics (custom)
http_request_duration_ms
http_requests_total
```

### Grafana Dashboards

1. Open **http://localhost:3003**
2. Login: `admin` / `nexus_grafana` (or your `GRAFANA_PASSWORD`)
3. Import dashboard ID **11159** (Node.js Application Dashboard)

Metrics available:
- Real-time CPU Usage
- Heap Memory Usage
- Event Loop Lag
- Active Handles / Active Requests

### Prometheus

- **URL**: http://localhost:9090
- **Scrape config**: `infra/prometheus/prometheus.yml`
- **Scrape target**: `api:3001/metrics` (internal Docker network)

### Structured Logging (Winston)

```json
{
  "level": "info",
  "message": "User logged in",
  "service": "nexus-api",
  "environment": "development",
  "userId": "64f...",
  "tenantId": "64e...",
  "timestamp": "2026-06-18T12:00:00.000Z"
}
```

Log files rotate daily in `logs/` directory.

---

## Security

| Layer | Implementation |
|---|---|
| **Authentication** | JWT (HS256), 15m access token + 7d refresh token with rotation |
| **Password Hashing** | bcrypt (10 rounds) |
| **Multi-Tenancy** | Every query scoped by `tenantId` — cross-tenant leakage prevented at model level |
| **Rate Limiting** | Global: configurable per window. AI endpoints: stricter limit |
| **Security Headers** | Helmet — CSP, HSTS, XSS protection, no-sniff |
| **Credential Encryption** | Integration tokens encrypted at rest using AES-256 with `ENCRYPTION_KEY` |
| **Webhook Verification** | Raw body preserved, HMAC signature verified per provider |
| **Audit Logging** | All auth + mutation events logged with userId, tenantId, IP, timestamp |
| **Account Lockout** | 5 failed login attempts → 15m lockout |
| **Session Blacklisting** | Logout blacklists JTI in Redis — immediate invalidation |
| **CORS** | Whitelist-based, credentials-enabled for known origins only |

> **Production checklist**: Rotate `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY` before deploying. Never commit `.env` — only `.env.example` is tracked.

---

## Troubleshooting

### Redis: NOAUTH Authentication required

```bash
# Ensure REDIS_URL includes password
REDIS_URL=redis://:YOUR_REDIS_PASSWORD@localhost:6379

# PowerShell (temporary override)
$env:REDIS_URL="redis://:nexus_redis_password@localhost:6379"
npm run dev
```

### API container exits immediately

```bash
docker-compose logs api --tail=50
```

Common causes:
- Missing required env var → check `env.validator.js` output
- MongoDB / Redis not ready → wait for healthcheck or restart
- Port 3001 already in use

### Qdrant connection refused (non-fatal)

API continues without vector search if Qdrant is unavailable. To enable:

```bash
# Inside Docker: use service name
QDRANT_URL=http://qdrant:6333

# From host machine
QDRANT_URL=http://localhost:6333
```

### MongoDB authentication failed

```bash
cat .env | grep MONGO
# Verify MONGODB_URI uses correct user/password/authSource
```

### Prometheus showing 404 on `/metrics`

Ensure `common/metrics.js` is imported in `main.js` before the 404 handler.

### Grafana shows "No data"

```bash
# Check API metrics reachable
curl http://localhost:3001/metrics

# Check Prometheus targets
# Open http://localhost:9090/targets
```

### Jest tests failing locally

```bash
# Ensure .env.test exists at repo root
# jest.setup.env.js loads it automatically via setupFiles
npm test
```

---

## Design Decisions

### Why MongoDB?

Flexible schema suits varied data shapes across agents, workflows, integrations, and RAG documents. Per-tenant isolation via indexed `tenantId` on every collection.

### Why Redis?

Session/refresh token storage with TTL, Bull queue backend for background jobs, and response caching for dashboard aggregations.

### Why Qdrant?

Purpose-built vector database optimized for approximate nearest-neighbor search. Supports payload filtering by `tenantId` ensuring RAG results are tenant-isolated.

### Why BaseConnector Pattern?

`connector.base.js` provides a common interface (token management, error handling, retry logic). Each integration extends it. Adding a new integration = one new file, no changes to core.

### Why prom-client + Grafana over a hosted solution?

Zero external dependency, zero cost, runs inside Docker Compose. Prometheus scrapes `/metrics`, Grafana visualizes. Horizontally scalable with push gateway if needed.

### Why Jest + Supertest over unit tests only?

Integration tests catch the full request lifecycle — middleware, auth, DB, response shape. 26 tests cover all critical paths (auth, health, metrics) with failure-path coverage.

---

## Roadmap

- [x] CI/CD pipeline (GitHub Actions — lint + test + build + Docker validation)
- [x] OpenAPI / Swagger documentation (`/api/docs`)
- [x] Jest integration test suite (26/26 passing)
- [x] Multi-stage Docker builds
- [x] RBAC permission matrix (admin / manager / analyst / viewer) — role hierarchy + authorize() middleware implemented
- [ ] HubSpot, Notion, Google Sheets connectors
- [ ] Agent marketplace (shareable agent templates)
- [ ] Sentry error tracking integration
- [ ] Automated DB migrations
- [ ] End-to-end test suite (Playwright)
- [ ] `/ready` endpoint for Kubernetes readiness probes
- [ ] Production Docker Compose with resource limits

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit with conventional commits: `git commit -m "feat: add new integration"`
4. Push and open a Pull Request

---

## License

MIT License — see [LICENSE](./LICENSE) for details.

---

<div align="center">

Built with care by **Sumit Bhaskar**

[![GitHub](https://img.shields.io/badge/GitHub-sumitbhskr-181717?style=flat-square&logo=github)](https://github.com/sumitbhskr)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Sumit%20Bhaskar-0A66C2?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/sumit-bhaskar-a44367384)

![Made with Node.js](https://img.shields.io/badge/Made%20with-Node.js-339933?style=flat-square&logo=node.js)
![Tested with Jest](https://img.shields.io/badge/Tested%20with-Jest-C21325?style=flat-square&logo=jest)
![Documented with Swagger](https://img.shields.io/badge/Documented%20with-Swagger-85EA2D?style=flat-square&logo=swagger)

</div>
