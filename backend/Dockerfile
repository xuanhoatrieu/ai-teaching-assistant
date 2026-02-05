# Build stage
FROM node:20-alpine AS builder

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files AND prisma.config.ts (Prisma 7 requirement)
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Create .env with dummy DATABASE_URL for prisma generate
RUN echo "DATABASE_URL=postgresql://user:pass@localhost:5432/db" > .env

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files AND prisma.config.ts
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Create .env with dummy DATABASE_URL for prisma generate
RUN echo "DATABASE_URL=postgresql://user:pass@localhost:5432/db" > .env

# Install production dependencies only
RUN npm ci --only=production

# Generate Prisma client
RUN npx prisma generate

# Copy built application
COPY --from=builder /app/dist ./dist

# Remove dummy .env (will use real env at runtime)
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
CMD ["node", "dist/main"]
