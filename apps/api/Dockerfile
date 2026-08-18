# ============================================================
# FakhriPOS API — Dockerfile multi-stage (Bun runtime)
# Build context: apps/api (Dokploy rootDirectory: apps/api)
# Deploy: Dokploy akan men-set DATABASE_URL & JWT_SECRET via env.
# ============================================================

# ---------- Stage 1: dependencies + source ----------
FROM oven/bun:1 AS build
WORKDIR /app

# Install deps dulu (cache layer terpisah)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Salin source
COPY . .

# ---------- Stage 2: runtime ----------
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Non-root user (praktik baik di homelab)
RUN useradd -m -u 1001 pos && chown -R pos:pos /app
USER pos

COPY --from=build --chown=pos:pos /app/node_modules ./node_modules
COPY --from=build --chown=pos:pos /app/package.json ./
COPY --from=build --chown=pos:pos /app/tsconfig.json ./
COPY --from=build --chown=pos:pos /app/src ./src

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["bun", "src/index.ts"]
