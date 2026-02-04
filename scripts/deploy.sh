#!/bin/bash

# =================================
# AI Teaching Assistant Deploy Script
# =================================

set -e

echo "🚀 Deploying AI Teaching Assistant..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and fill in your values."
    exit 1
fi

# Pull latest changes
echo "📦 Pulling latest code..."
git pull origin main

# Build and start containers
echo "🔨 Building containers..."
docker-compose -f docker-compose.prod.yml build

echo "🏁 Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 10

# Run database migrations
echo "🗄️ Running database migrations..."
docker-compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy

# Show status
echo ""
echo "✅ Deployment complete!"
echo ""
docker-compose -f docker-compose.prod.yml ps
echo ""
echo "📊 Access points:"
echo "   Frontend: http://localhost"
echo "   Backend:  http://localhost:3001"
echo "   MinIO:    http://localhost:9001"
echo ""
echo "📝 Useful commands:"
echo "   View logs:    docker-compose -f docker-compose.prod.yml logs -f"
echo "   Stop:         docker-compose -f docker-compose.prod.yml down"
echo "   Restart:      docker-compose -f docker-compose.prod.yml restart"
