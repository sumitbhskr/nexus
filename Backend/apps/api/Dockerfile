# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY src/ ./src/
COPY __tests__/ ./__tests__/

# ── Runtime ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 expressjs
WORKDIR /app
COPY --from=base --chown=expressjs:nodejs /app/node_modules ./node_modules
COPY --from=base --chown=expressjs:nodejs /app/src          ./src
COPY --from=base --chown=expressjs:nodejs /app/__tests__    ./__tests__
COPY --chown=expressjs:nodejs package.json ./
RUN mkdir -p /app/uploads /app/coverage && chown -R expressjs:nodejs /app/uploads /app/coverage
USER expressjs
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "src/main.js"]