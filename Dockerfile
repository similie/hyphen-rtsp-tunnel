# ---------- 1️⃣ Build stage ----------
FROM node:20-bookworm AS builder

# Set workdir
WORKDIR /app

# Copy dependency manifests first for efficient caching
# COPY package.json pnpm-lock.yaml* package-lock.json* yarn.lock* ./
COPY package.json pnpm-lock.yaml* package-lock.json* yarn.lock* ./

# Install deps (prefer pnpm if lockfile exists)
RUN if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && \
      pnpm install --prod --dangerously-allow-all-builds --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      corepack enable && yarn install --frozen-lockfile; \
    else \
      npm ci; \
    fi

# Copy source files
COPY . .

# Build (adjust this if your build step differs)
RUN if [ -f tsconfig.json ]; then \
      npm run build || pnpm run build || yarn build; \
    fi

# ---------- 2️⃣ Runtime stage ----------
FROM node:20-slim AS runner
# Declare where global packages will live
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

# Copy package files & install only production deps
COPY package.json pnpm-lock.yaml* package-lock.json* yarn.lock* ./
RUN if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && \
      pnpm install --prod --dangerously-allow-all-builds --frozen-lockfile && \
      pnpm add tsx --save-prod; \
    elif [ -f yarn.lock ]; then \
      corepack enable && \
      yarn install --production --frozen-lockfile && \
      yarn global add tsx; \
    else \
      npm ci --omit=dev && \
      npm install -g tsx; \
    fi



# Copy compiled app from builder
# COPY --from=builder /app/dist ./dist
COPY tsconfig.json ./
COPY --from=builder /app/src ./src

# Copy other needed runtime assets (e.g. .env, migrations)
# COPY --from=builder /app/migrations ./migrations
# COPY --from=builder /app/public ./public

# Set environment
# ENV NODE_ENV=production \
#     PORT=1612
COPY build-system ./build-system
# Expose port
EXPOSE 1612

# # Healthcheck (optional)
# HEALTHCHECK --interval=30s --timeout=10s --start-period=10s \
#   CMD node -e "require('http').get('http://localhost:1612/health', r => process.exit(r.statusCode !== 200 ? 1 : 0))" || exit 1

# Default command
CMD ["pnpm", "exec", "tsx", "src/index.ts"]