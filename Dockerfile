# Multi-stage build for API server

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Change ownership of the app directory to node user
RUN chown -R node:node /app

# Switch to node user
USER node

# Copy package files
COPY --chown=node:node package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install && \
    npm cache clean --force

# Copy source code
COPY --chown=node:node . .

# Build TypeScript
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Change ownership of the app directory to node user
RUN chown -R node:node /app

# Switch to node user
USER node

# Set to production environment
ENV NODE_ENV=production

# Copy package files
COPY --chown=node:node package*.json ./

# Install only production dependencies
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy built application
COPY --from=builder --chown=node:node /app/dist ./dist

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["npm", "start"]
