# syntax=docker/dockerfile:1
# PedifyAI — imágenes de producción (multi-etapa). Guía de despliegue: docs/deployment.md

# ─── Dependencias completas (incluye Prisma CLI, TypeScript, tsx y Tailwind) ───
FROM node:24-alpine AS deps
# Prisma (migraciones) necesita OpenSSL en Alpine.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# `postinstall` ejecuta `prisma generate`.
RUN npm ci --no-audit --no-fund

# ─── Herramientas: migraciones, administradores, datos de demostración y verificación ───
#   docker compose run --rm tools npx prisma migrate deploy
#   docker compose run --rm tools npm run admin:grant -- correo@dominio.com
FROM deps AS tools
COPY . .
CMD ["npx", "prisma", "migrate", "deploy"]

# ─── Compilación: CSS de Tailwind (minificado) + TypeScript ───
FROM tools AS build
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

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
