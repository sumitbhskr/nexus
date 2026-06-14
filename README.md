# NEXUS

**Enterprise Decision Intelligence & Autonomous Workflow Platform**

NEXUS unifies AI agents, automated workflows, RAG-based knowledge retrieval, and third-party SaaS integrations (Jira, Salesforce, Slack, Zendesk, HubSpot, Notion, Google Sheets) into a single operational dashboard — with end-to-end observability via OpenTelemetry, Prometheus, and Grafana.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Monitoring & Observability](#monitoring--observability)
- [Security Notes](#security-notes)
- [Roadmap](#roadmap)

---

## Architecture Overview

```
                         ┌─────────────────────┐
                         │     Next.js Web      │
                         │  (Dashboard / Login)  │
                         └──────────┬───────────┘
                                     │ REST + WebSocket
                                     ▼
                         ┌─────────────────────┐
                         │     Express API       │
                         │  Auth · Agents ·       │
                         │  Workflows · Approvals │
                         │  · Integrations · RAG  │
                         └──┬───────┬───────┬────┘
                            │       │       │
                  ┌─────────┘  ┌────┘   └───────────┐
                  ▼            ▼                    ▼
            ┌───────────┐ ┌──────────┐      ┌──────────────┐
            │  MongoDB   │ │  Redis    │      │   Qdrant       │
            │ (primary    │ │ (cache,   │      │ (vector store  │
            │  data store)│ │  queues)  │      │  for RAG)      │
            └───────────┘ └──────────┘      └──────────────┘

                            │
                            ▼
         ┌──────────────────────────────────────────┐
         │  External Integrations (via connectors)    │
         │  Jira · Salesforce · Slack · Zendesk ·      │
         │  HubSpot · Notion · Google Sheets           │
         └──────────────────────────────────────────┘

                            │
                            ▼
         ┌──────────────────────────────────────────┐
         │  Observability: OpenTelemetry → Prometheus  │
         │  → Grafana dashboards                       │
         └──────────────────────────────────────────┘
```

**Core flows:**
1. **Auth** — JWT access + refresh token flow, RBAC-ready.
2. **Agents** — LangGraph/LangChain-based agents call internal tools and external connectors, with execution traced via OpenTelemetry.
3. **Workflows** — `workflowEngine` + `workflowScheduler` execute multi-step automations, with approval gates handled by the `approvals` module.
4. **RAG** — Documents are embedded (OpenAI embeddings) and stored in Qdrant; `rag.service.js` retrieves context for agent prompts.
5. **Events** — `eventBus` decouples module-to-module communication (e.g., workflow completion → notification).
6. **Realtime** — Socket.io pushes live updates (agent runs, approvals, workflow status) to the dashboard.

---

## Tech Stack

**Backend** (`Backend/apps/api`)
- Node.js 20 + Express
- MongoDB 7 (Mongoose) — primary data store
- Redis 7 — caching, session/queue backend (Bull)
- Qdrant — vector database for RAG
- Socket.io — real-time updates
- LangChain / LangGraph + Anthropic & OpenAI SDKs — AI agent orchestration
- OpenTelemetry + `prom-client` — metrics & distributed tracing
- JWT (access + refresh), Helmet, `express-rate-limit`, Winston (daily rotate) — security & logging
- Joi / Zod — request validation

**Frontend** (`Frontend/apps/web`)
- Next.js 14 (App Router) + TypeScript
- TanStack React Query — server-state management
- Zustand — client state
- Tailwind CSS

**Infrastructure**
- Docker & Docker Compose (multi-stage builds, non-root containers)
- MongoDB, Redis, Qdrant
- Prometheus + Grafana (provisioned dashboards & datasources)

---

## Project Structure

```
nexus/
├── Backend/apps/api/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── main.js                    # app entrypoint
│       ├── common/
│       │   ├── middleware/
│       │   │   ├── auth.js
│       │   │   ├── auditLog.js
│       │   │   ├── errorHandler.js
│       │   │   ├── rateLimiter.js
│       │   │   └── requestLogger.js
│       │   └── utils/
│       │       └── logger.js
│       ├── config/
│       │   ├── database.js
│       │   ├── env.validator.js       # fail-fast env validation
│       │   ├── qdrant.js
│       │   ├── redis.js
│       │   └── socket.js
│       ├── modules/
│       │   ├── agents/                # agent.model/routes/service + agentRunner + tools/
│       │   ├── approvals/             # approval.model/routes/service
│       │   ├── auth/                  # auth.controller/model/routes/service
│       │   ├── dashboard/             # dashboard.routes
│       │   ├── events/                # eventBus.js
│       │   ├── integrations/
│       │   │   ├── jira/
│       │   │   ├── salesforce/
│       │   │   ├── slack/
│       │   │   ├── zendesk/
│       │   │   ├── connector.base.js
│       │   │   ├── integration.routes.js
│       │   │   └── webhook.routes.js
│       │   ├── observability/         # observability.routes, tracer.js
│       │   ├── rag/                   # rag.routes/service
│       │   └── workflows/             # workflow.model/routes/service + workflowEngine + workflowScheduler
│       └── scripts/
│           ├── mongo-init.js
│           └── seed.js
│
├── Frontend/apps/web/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx
│       ├── providers.tsx
│       ├── globals.css
│       ├── dashboard/
│       │   └── page.tsx
│       ├── login/
│       │   └── page.tsx
│       └── lib/
│           ├── api.ts
│           ├── auth.ts
│           └── ws.ts
│
├── infra/
│   ├── grafana/
│   │   ├── dashboards/
│   │   └── datasources/
│   └── prometheus/
│       └── prometheus.yml
│
├── docker-compose.yml
├── package.json                       # root workspace config
├── .env.example
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites
- Docker & Docker Compose
- Node.js >= 20 and npm >= 10 (for local dev without Docker)

### 1. Environment Setup

```bash
cp .env.example .env
```

Fill in the required secrets (see [Environment Variables](#environment-variables)). At minimum for local dev: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, and at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.

### 2. Run with Docker (recommended)

```bash
npm run docker:dev
```

Starts MongoDB, Redis, Qdrant, API, Web, Prometheus, and Grafana.

| Service     | URL                     |
|-------------|-------------------------|
| Web (UI)    | http://localhost:3000   |
| API         | http://localhost:3001   |
| MongoDB     | localhost:27017         |
| Redis       | localhost:6379          |
| Qdrant      | http://localhost:6333   |
| Prometheus  | http://localhost:9090   |
| Grafana     | http://localhost:3003   |

Stop and remove containers + volumes:

```bash
npm run docker:down
```

### 3. Local Development (without Docker)

```bash
npm install
npm run dev
```

Runs the API (`:3001`) and Web (`:3000`) concurrently via npm workspaces. MongoDB, Redis, and Qdrant must be running separately:

```bash
docker-compose up mongodb redis qdrant
```

### 4. Seed the Database

```bash
npm run db:seed
```

---

## Environment Variables

All variables are documented in `.env.example`. Key groups:

| Group              | Variables                                                                 | Notes |
|--------------------|----------------------------------------------------------------------------|-------|
| App                | `NODE_ENV`, `PORT`, `APP_URL`, `FRONTEND_URL`                              | Core runtime config |
| Auth               | `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` | Use 64+ char random strings in production |
| MongoDB            | `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`, `MONGODB_URI`                    | |
| Redis              | `REDIS_PASSWORD`, `REDIS_URL`                                              | |
| Qdrant             | `QDRANT_URL`, `QDRANT_COLLECTION`                                          | |
| AI / LLM           | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LLM_MODEL`, `EMBEDDING_MODEL`, `LLM_MAX_TOKENS`, `LLM_TEMPERATURE` | At least one provider key required |
| Integrations       | `SALESFORCE_*`, `JIRA_*`, `SLACK_*`, `ZENDESK_*`, `HUBSPOT_*`, `NOTION_*`, `GOOGLE_*` | Only required if that integration is enabled |
| Encryption         | `ENCRYPTION_KEY`                                                           | 32-char key for encrypting stored integration credentials |
| Rate Limiting      | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `AI_RATE_LIMIT_MAX`     | |
| File Upload        | `UPLOAD_MAX_SIZE_MB`, `UPLOAD_DIR`                                         | |
| Observability      | `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, `SENTRY_DSN` | |
| Grafana            | `GRAFANA_USER`, `GRAFANA_PASSWORD`                                         | |
| Frontend (public)  | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_APP_NAME`        | Exposed to the browser — no secrets here |

> Startup validation (`config/env.validator.js`) fails fast if required variables are missing or malformed — check API logs on boot if the container exits immediately.

---

## Available Scripts

| Command                 | Description                          |
|--------------------------|---------------------------------------|
| `npm run dev`            | Run API + Web in dev mode (concurrently) |
| `npm run dev:api`        | Run API only                          |
| `npm run dev:web`        | Run Web only                          |
| `npm run build`          | Build API + Web for production       |
| `npm test`               | Run tests across all workspaces       |
| `npm run test:api`       | Run API tests with coverage          |
| `npm run lint`           | Lint all workspaces                   |
| `npm run lint:fix`       | Lint and auto-fix                     |
| `npm run db:seed`        | Seed MongoDB with initial data       |
| `npm run docker:dev`     | Start full stack via Docker Compose  |
| `npm run docker:prod`    | Start production stack (`infra/docker/docker-compose.prod.yml`) |
| `npm run docker:down`    | Stop containers and remove volumes    |

---

## Monitoring & Observability

- **Metrics**: API exposes Prometheus-format metrics via `prom-client`; Prometheus scrapes per `infra/prometheus/prometheus.yml`.
- **Tracing**: OpenTelemetry SDK auto-instruments the API; configure exporter via `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Dashboards**: Grafana auto-provisions dashboards/datasources from `infra/grafana/`. Default login is `GRAFANA_USER` / `GRAFANA_PASSWORD` from `.env`.
- **Logging**: Winston with daily file rotation; set verbosity via `LOG_LEVEL`.
- **Error Tracking**: Optional Sentry integration via `SENTRY_DSN`.
- **Health Checks**: MongoDB, Redis, and Qdrant containers have Docker healthchecks; the API should expose a `/health` endpoint consumed by orchestration and uptime monitors.

---

## Security Notes

- Rotate `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY` before deploying to any shared/production environment — defaults in `.env.example` are placeholders only.
- Integration credentials (Salesforce, Jira, Slack tokens, etc.) are encrypted at rest using `ENCRYPTION_KEY`.
- Rate limiting is applied globally (`RATE_LIMIT_*`) and more strictly on AI endpoints (`AI_RATE_LIMIT_MAX`) to control LLM cost exposure.
- Never commit `.env` — only `.env.example` with placeholder values should be tracked (see `.gitignore`).

---

## Roadmap

- [ ] `/health` and `/ready` endpoints for orchestration probes
- [ ] CI pipeline (lint + test + build on PR)
- [ ] Production Docker Compose / deployment manifests (`infra/docker/docker-compose.prod.yml`)
- [ ] RBAC role/permission matrix documentation
- [ ] API reference (OpenAPI/Swagger)
