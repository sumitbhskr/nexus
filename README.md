# NEXUS — Enterprise Decision Intelligence Platform

<div align="center">

![NEXUS](https://img.shields.io/badge/NEXUS-Enterprise%20AI-6C3DF4?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=next.js)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=for-the-badge&logo=mongodb)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker)
![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-E6522C?style=for-the-badge&logo=prometheus)
![Grafana](https://img.shields.io/badge/Grafana-Dashboards-F46800?style=for-the-badge&logo=grafana)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**A production-grade, multi-tenant SaaS platform that unifies AI agents, automated workflows, RAG-based knowledge retrieval, and third-party SaaS integrations into a single operational command center — with full observability.**

[Features](#features) • [Architecture](#architecture-overview) • [Tech Stack](#tech-stack) • [Getting Started](#getting-started) • [API Reference](#api-reference) • [Monitoring](#monitoring--observability) • [Security](#security) • [Roadmap](#roadmap)

</div>

---

## What is NEXUS?

NEXUS is a multi-tenant enterprise platform that lets organizations:

- **Run AI Agents** — LangChain/LangGraph-powered agents that reason, call tools, and trigger workflows
- **Automate Workflows** — Multi-step business process automation with scheduling and approval gates
- **Search with RAG** — OpenAI-embedding-based document retrieval via Qdrant vector database
- **Integrate SaaS tools** — Salesforce, Jira, Slack, Zendesk, HubSpot, Notion, Google Sheets via a unified connector system
- **Monitor everything** — Real-time Grafana dashboards powered by Prometheus metrics and OpenTelemetry tracing

---

## Features

| Feature | Description |
|---|---|
| **Multi-Tenant Auth** | JWT access + refresh token flow, RBAC, per-tenant isolation |
| **AI Agents** | LangChain agents with tool-calling, traced via OpenTelemetry |
| **Workflow Engine** | Multi-step automations with scheduling and human-in-the-loop approvals |
| **RAG Pipeline** | Document ingestion → OpenAI embeddings → Qdrant → context-aware agent prompts |
| **SaaS Integrations** | Connector pattern supporting Salesforce, Jira, Slack, Zendesk, HubSpot, Notion, Google Sheets |
| **Real-time Updates** | Socket.IO pushes live agent/workflow/approval status to dashboard |
| **Event Bus** | Internal pub/sub decouples module-to-module communication |
| **Observability** | Prometheus metrics, Grafana dashboards, OpenTelemetry distributed tracing, Winston logging |
| **Security** | Helmet, CORS, rate limiting, encrypted credentials at rest, audit logs |
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
│   │              Integrations Layer (Connector Pattern)           │  │
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
| prom-client | latest | Prometheus metrics |
| OpenTelemetry | latest | Distributed tracing |
| Winston | 3.x | Structured JSON logging |
| JWT | 9.x | Stateless authentication |
| bcrypt | 5.x | Password hashing |
| Helmet | 7.x | Security headers |
| express-rate-limit | 7.x | API rate limiting |

### Frontend (`Frontend/apps/web`)

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
| Prometheus | Metrics collection & alerting |
| Grafana | Metrics visualization & dashboards |
| Multi-stage Dockerfile | Optimized production images, non-root user |

---

## Project Structure

```
nexus/
├── Backend/
│   └── apps/
│       └── api/
│           ├── Dockerfile                    # Multi-stage build, non-root container
│           ├── package.json
│           └── src/
│               ├── main.js                   # App entrypoint, bootstrap, graceful shutdown
│               ├── common/
│               │   ├── metrics.js            # prom-client Prometheus metrics
│               │   ├── middleware/
│               │   │   ├── auth.js           # JWT verification middleware
│               │   │   ├── auditLog.js       # Audit trail middleware
│               │   │   ├── errorHandler.js   # Global error handler
│               │   │   ├── rateLimiter.js    # express-rate-limit config
│               │   │   └── requestLogger.js  # Structured request logging
│               │   └── utils/
│               │       └── logger.js         # Winston logger (JSON + daily rotate)
│               ├── config/
│               │   ├── database.js           # MongoDB connection + health
│               │   ├── env.validator.js      # Fail-fast env validation on startup
│               │   ├── qdrant.js             # Qdrant client + collection init
│               │   ├── redis.js              # Redis client + health check
│               │   └── socket.js             # Socket.IO server init
│               ├── modules/
│               │   ├── agents/               # agent.model / routes / service / agentRunner / tools
│               │   ├── approvals/            # approval.model / routes / service
│               │   ├── auth/                 # auth.controller / model / routes / service
│               │   ├── dashboard/            # dashboard.routes (aggregated stats)
│               │   ├── events/               # eventBus.js (internal pub/sub)
│               │   ├── integrations/
│               │   │   ├── connector.base.js # BaseConnector (abstract, extended by all)
│               │   │   ├── salesforce/       # SalesforceConnector
│               │   │   ├── jira/             # JiraConnector
│               │   │   ├── slack/            # SlackConnector
│               │   │   ├── zendesk/          # ZendeskConnector
│               │   │   ├── integration.routes.js
│               │   │   └── webhook.routes.js # Raw body preserved for HMAC verification
│               │   ├── observability/        # observability.routes / tracer.js (OTEL)
│               │   ├── rag/                  # rag.routes / rag.service (embed + retrieve)
│               │   └── workflows/            # workflow.model / routes / service
│               │                             # workflowEngine / workflowScheduler
│               └── scripts/
│                   └── mongo-init.js         # DB init scripts
│
├── Frontend/
│   └── apps/
│       └── web/
│           ├── Dockerfile
│           ├── package.json
│           ├── next.config.js
│           ├── tailwind.config.js
│           ├── tsconfig.json
│           └── app/
│               ├── layout.tsx
│               ├── page.tsx
│               ├── providers.tsx
│               ├── globals.css
│               ├── dashboard/
│               │   └── page.tsx              # Operations Command Center
│               ├── login/
│               │   └── page.tsx              # JWT login page
│               └── lib/
│                   ├── api.ts                # Axios API client
│                   ├── auth.ts               # Auth helpers
│                   └── ws.ts                 # Socket.IO client
│
├── infra/
│   ├── grafana/
│   │   ├── dashboards/                       # Auto-provisioned Grafana dashboards
│   │   └── datasources/                      # Prometheus datasource config
│   └── prometheus/
│       └── prometheus.yml                    # Scrape config (scrapes /metrics on API)
│
├── docker-compose.yml                        # Full local dev stack
├── package.json                              # npm workspaces root
├── .env.example                              # All env vars documented
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (recommended)
- Node.js >= 20 and npm >= 10 (for local dev without Docker)

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/nexus.git
cd nexus
```

### 2. Environment Setup

```bash
cp .env.example .env
```

At minimum for local dev, fill in:

```env
JWT_SECRET=your-64-char-random-string
JWT_REFRESH_SECRET=another-64-char-random-string
ENCRYPTION_KEY=32-char-key-for-encrypting-creds

# At least one AI provider key required
ANTHROPIC_API_KEY=sk-ant-...
# OR
OPENAI_API_KEY=sk-...
```

### 3. Start Full Stack (Docker — Recommended)

```bash
docker-compose up --build
```

Or in detached mode (background):

```bash
docker-compose up -d
```

### 4. Create First Admin User

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "tenantName": "My Organization",
    "email": "admin@example.com",
    "password": "SecurePass@123",
    "firstName": "Admin",
    "lastName": "User"
  }'
```

### 5. Access Services

| Service | URL | Credentials |
|---|---|---|
| **NEXUS Dashboard** | http://localhost:3000 | Email + password from step 4 |
| **API** | http://localhost:3001 | JWT Bearer token |
| **API Health** | http://localhost:3001/health | — |
| **API Metrics** | http://localhost:3001/metrics | — (Prometheus format) |
| **MongoDB** | localhost:27017 | See `.env` MONGO_ROOT_USER/PASSWORD |
| **Redis** | localhost:6379 | See `.env` REDIS_PASSWORD |
| **Qdrant** | http://localhost:6333 | — |
| **Prometheus** | http://localhost:9090 | — |
| **Grafana** | http://localhost:3003 | admin / See `.env` GRAFANA_PASSWORD |

---

## Available Scripts

```bash
# ─── Docker ───────────────────────────────────────────
docker-compose up --build        # Build and start full stack
docker-compose up -d             # Start in background (detached)
docker-compose down              # Stop all containers
docker-compose down -v           # Stop + remove volumes (fresh DB)
docker-compose restart api       # Restart only API container
docker-compose logs api -f       # Stream API logs
docker-compose logs --tail=50    # Last 50 lines of all services
docker-compose ps                # Status of all containers
docker-compose config --services # List all service names

# ─── Local Dev (without Docker) ───────────────────────
npm run dev                      # Run API + Web concurrently
npm run dev:api                  # Run API only (port 3001)
npm run dev:web                  # Run Web only (port 3000)

# ─── Build ────────────────────────────────────────────
npm run build                    # Build API + Web for production

# ─── Testing ──────────────────────────────────────────
npm test                         # Run tests across all workspaces
npm run test:api                 # Run API tests with coverage

# ─── Linting ──────────────────────────────────────────
npm run lint                     # Lint all workspaces
npm run lint:fix                 # Auto-fix lint issues

# ─── Database ─────────────────────────────────────────
npm run db:seed                  # Seed MongoDB with sample data

# ─── Debugging ────────────────────────────────────────
docker-compose exec api sh       # Shell into API container
docker-compose exec mongodb mongosh "mongodb://user:pass@localhost/nexus?authSource=admin"
docker-compose exec redis redis-cli -a your_password
```

---

## Environment Variables

All variables are documented in `.env.example`. Key groups:

| Group | Variables | Notes |
|---|---|---|
| **App** | `NODE_ENV`, `PORT`, `APP_URL`, `FRONTEND_URL` | Core runtime config |
| **Auth** | `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` | Use 64+ char random strings in production |
| **MongoDB** | `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`, `MONGODB_URI` | URI uses Docker service name in container |
| **Redis** | `REDIS_PASSWORD`, `REDIS_URL` | |
| **Qdrant** | `QDRANT_URL`, `QDRANT_COLLECTION` | Use `http://qdrant:6333` inside Docker |
| **AI / LLM** | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LLM_MODEL`, `EMBEDDING_MODEL` | At least one provider required |
| **Integrations** | `SALESFORCE_*`, `JIRA_*`, `SLACK_*`, `ZENDESK_*`, `HUBSPOT_*` | Only needed if integration is enabled |
| **Encryption** | `ENCRYPTION_KEY` | 32-char key — encrypts stored integration credentials |
| **Rate Limiting** | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `AI_RATE_LIMIT_MAX` | |
| **Observability** | `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, `SENTRY_DSN` | |
| **Grafana** | `GRAFANA_USER`, `GRAFANA_PASSWORD` | |
| **Frontend** | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_APP_NAME` | No secrets — exposed to browser |

> **Fail-fast validation**: `config/env.validator.js` validates all required variables on startup. If the API container exits immediately, check `docker-compose logs api` — a missing env var is the most common cause.

---

## API Reference

### Authentication

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
| GET | `/api/v1/agents` | JWT | List all agents for tenant |
| POST | `/api/v1/agents` | JWT | Create new agent |
| GET | `/api/v1/agents/:id` | JWT | Get agent details |
| POST | `/api/v1/agents/:id/run` | JWT | Execute agent |
| DELETE | `/api/v1/agents/:id` | JWT | Delete agent |

### Workflows

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/workflows` | JWT | List workflows |
| POST | `/api/v1/workflows` | JWT | Create workflow |
| POST | `/api/v1/workflows/:id/trigger` | JWT | Manually trigger workflow |
| GET | `/api/v1/workflows/:id/runs` | JWT | Get workflow run history |

### Integrations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/integrations` | JWT | List connected integrations |
| POST | `/api/v1/integrations/:provider/connect` | JWT | Connect a SaaS integration |
| DELETE | `/api/v1/integrations/:provider` | JWT | Disconnect integration |
| POST | `/api/v1/webhooks/:provider` | HMAC | Receive webhook from provider |

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
| GET | `/metrics` | None | Prometheus metrics endpoint |

---

## Monitoring & Observability

### Metrics (`/metrics`)

API exposes Prometheus-format metrics via `prom-client`:

```
# Default Node.js metrics
process_cpu_user_seconds_total
process_cpu_system_seconds_total
nodejs_heap_size_used_bytes
nodejs_event_loop_lag_seconds
nodejs_active_handles_total

# HTTP request metrics (custom)
http_request_duration_ms
http_requests_total
```

### Grafana Dashboards

1. Open **http://localhost:3003**
2. Login with `admin` / `nexus_grafana` (or your `GRAFANA_PASSWORD`)
3. Import dashboard ID **11159** (NodeJS Application Dashboard) for:
   - Real-time CPU Usage
   - Heap Memory Usage
   - Event Loop Lag
   - Active Handlers / Requests

### Prometheus

- **URL**: http://localhost:9090
- **Scrape config**: `infra/prometheus/prometheus.yml`
- **Scrape target**: `api:3001/metrics` (internal Docker network)

### Tracing

OpenTelemetry SDK auto-instruments the API. Configure exporter:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-collector:4318
```

### Logging

Winston with structured JSON output:

```json
{
  "level": "info",
  "message": "User logged in",
  "service": "nexus-api",
  "environment": "development",
  "userId": "...",
  "tenantId": "...",
  "timestamp": "2026-06-16T08:00:00.000Z"
}
```

Log files rotate daily in `logs/` directory.

---

## Security

| Layer | Implementation |
|---|---|
| **Authentication** | JWT (RS256), 15m access token + 7d refresh token with rotation |
| **Password Hashing** | bcrypt (10 rounds) |
| **Multi-Tenancy** | Every query scoped by `tenantId` — cross-tenant data leakage prevented at model level |
| **Rate Limiting** | Global: `RATE_LIMIT_MAX_REQUESTS` per window. AI endpoints: stricter `AI_RATE_LIMIT_MAX` |
| **Security Headers** | Helmet — CSP, HSTS, XSS protection, no sniff |
| **Credential Encryption** | Integration tokens encrypted at rest using AES-256 with `ENCRYPTION_KEY` |
| **Webhook Verification** | Raw body preserved, HMAC signature verified per provider |
| **Audit Logging** | All auth + mutation events logged with userId, tenantId, IP, timestamp |
| **Account Lockout** | 5 failed login attempts → 15m lockout with countdown |
| **CORS** | Whitelist-based, credentials-enabled for known origins only |

> **Production checklist**: Rotate `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY` before deploying. Never commit `.env` — only `.env.example` is tracked.

---

## Design Decisions

### Why MongoDB?

Flexible schema suits the varied data shapes across agents, workflows, integrations, and RAG documents. Per-tenant data is isolated via `tenantId` field indexed on every collection.

### Why Redis?

Session/refresh token storage with TTL, Bull queue backend for background jobs, and response caching for dashboard aggregations.

### Why Qdrant?

Purpose-built vector database optimized for approximate nearest-neighbor search. Supports payload filtering by `tenantId` ensuring RAG results are tenant-isolated.

### Why the BaseConnector Pattern?

`connector.base.js` provides a common interface (token management, error handling, retry logic). Each integration extends it. Adding a new integration = one new file, no changes to core.

### Why prom-client + Grafana over a hosted solution?

Zero external dependency, zero cost, runs inside Docker Compose. Prometheus scrapes `/metrics`, Grafana visualizes. Horizontally scalable with a push gateway if needed.

---

## Troubleshooting

### API container exits immediately

```bash
docker-compose logs api --tail=50
```

Most common causes:
- Missing required env var (check `env.validator.js` output)
- MongoDB / Redis not healthy yet (add `depends_on` healthcheck)
- Port conflict on 3001

### Prometheus showing 404 on `/metrics`

Ensure `common/metrics.js` exists and is imported in `main.js` before the 404 handler.

### Qdrant connection refused

Check `QDRANT_URL` in `.env`:
- Inside Docker container: `http://qdrant:6333`
- From host machine: `http://localhost:6333`

### MongoDB authentication failed

```bash
cat .env | grep MONGO
# Verify MONGODB_URI uses correct user/password
```

### Grafana shows "No data"

Prometheus must be scraping the API. Check:

```bash
# Is API /metrics reachable?
curl http://localhost:3001/metrics

# Is Prometheus scraping?
# Open http://localhost:9090/targets
```

---

## Roadmap

- [ ] `/ready` endpoint for Kubernetes readiness probes
- [ ] CI/CD pipeline (GitHub Actions — lint + test + build + Docker push)
- [ ] Production Docker Compose with resource limits
- [ ] OpenAPI / Swagger documentation (`/api/v1/docs`)
- [ ] RBAC permission matrix (viewer / editor / admin / super-admin)
- [ ] HubSpot, Notion, Google Sheets connectors
- [ ] Agent marketplace (shareable agent templates)
- [ ] Sentry error tracking integration
- [ ] Automated DB migrations
- [ ] End-to-end test suite (Playwright)

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

![Made with Node.js](https://img.shields.io/badge/Made%20with-Node.js-339933?style=flat-square&logo=node.js)


</div>
