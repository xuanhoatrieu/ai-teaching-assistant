# Build stage - Use Node 22 for Prisma 7 compatibility
FROM node:22-alpine AS builder

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files AND prisma.config.ts (Prisma 7 requirement)
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Create .env with dummy DATABASE_URL for prisma generate
RUN echo "DATABASE_URL=postgresql://user:pass@localhost:5432/db" > .env

# Install dependencies (including devDependencies for prisma)
RUN npm ci

# Generate Prisma client BEFORE copying source (critical for Prisma 7)
RUN npx prisma generate

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage - Use Node 22 for Prisma 7 compatibility
FROM node:22-alpine AS production

# Install OpenSSL for Prisma runtime
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files AND prisma.config.ts
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Create .env with dummy DATABASE_URL for prisma generate
RUN echo "DATABASE_URL=postgresql://user:pass@localhost:5432/db" > .env

# Install production dependencies
RUN npm ci --omit=dev

# Install prisma CLI for generate (needed in production stage)
RUN npm install prisma

# Generate Prisma client
RUN npx prisma generate

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma client from builder (since devDeps aren't installed here)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Remove dummy .env
RUN rm .env

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the application
CMD ["node", "dist/src/main"]
