# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src/ ./src/

# ── Runtime ──────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 expressjs

WORKDIR /app

COPY --from=base --chown=expressjs:nodejs /app/node_modules ./node_modules
COPY --from=base --chown=expressjs:nodejs /app/src          ./src
COPY --chown=expressjs:nodejs package.json ./

RUN mkdir -p /app/uploads && chown -R expressjs:nodejs /app/uploads

USER expressjs

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "src/main.js"]