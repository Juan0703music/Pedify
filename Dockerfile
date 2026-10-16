# syntax=docker/dockerfile:1
# PedifyAI — imagen de producción (multi-etapa).

# ─── Dependencias completas (incluye Prisma CLI, TypeScript y Tailwind) ───
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# `postinstall` ejecuta `prisma generate`.
RUN npm ci

# ─── Compilación: CSS de Tailwind + TypeScript ───
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

# ─── Migraciones: `docker compose run --rm migrate` o servicio previo al arranque ───
FROM deps AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ─── Ejecución ───
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S pedify && adduser -S pedify -G pedify \
  && mkdir -p /app/uploads && chown pedify:pedify /app/uploads
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
USER pedify
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
CMD ["node", "dist/server.js"]
