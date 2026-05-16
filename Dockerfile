# Stage 1: Build
FROM node:26-alpine@sha256:e71ac5e964b9201072425d59d2e876359efa25dc96bb1768cb73295728d6e4ea AS builder

WORKDIR /app

# Copy only package files first (better layer caching)
COPY package*.json ./

# Install all dependencies (needed for build)
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies to reduce size
RUN npm prune --production && \
    rm -rf ~/.npm /tmp/*

# Stage 2: Runtime (smaller image)
FROM node:26-alpine@sha256:e71ac5e964b9201072425d59d2e876359efa25dc96bb1768cb73295728d6e4ea AS runtime

# Install Chromium and cleanup in single layer
RUN apk add --no-cache chromium && \
    rm -rf /var/cache/apk/*

# Chromium configuration
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

WORKDIR /app

# Copy only production dependencies and built code
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Create patterns directory
RUN mkdir -p patterns

# Create default config for headless mode in container
RUN echo '{"headless":true}' > config.json

EXPOSE 3000
CMD ["node", "dist/index.js"]