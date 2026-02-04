#!/bin/bash
# AI Teaching Assistant - VPS Deployment Script
# Run this script on your Ubuntu VPS

set -e

echo "🚀 AI Teaching Assistant - VPS Deployment"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo -e "${GREEN}✅ Docker installed${NC}"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}Installing Docker Compose...${NC}"
    sudo apt-get update
    sudo apt-get install -y docker-compose-plugin
    echo -e "${GREEN}✅ Docker Compose installed${NC}"
fi

# Create .env.production if not exists
if [ ! -f .env.production ]; then
    echo -e "${YELLOW}Creating .env.production...${NC}"
    cat > .env.production << 'EOF'
# Database
POSTGRES_DB=ai_teaching
POSTGRES_USER=postgres
POSTGRES_PASSWORD=CHANGE_THIS_STRONG_PASSWORD

# JWT
JWT_SECRET=CHANGE_THIS_TO_RANDOM_64_CHAR_STRING

# Encryption
ENCRYPTION_KEY=CHANGE_THIS_32_CHAR_KEY_HERE!!!

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=CHANGE_THIS_MINIO_PASSWORD
MINIO_BUCKET=ai-teaching

# CLIProxy (if using)
CLIPROXY_URL=https://cliproxy.hoclieu.id.vn
CLIPROXY_API_KEY=ai-teaching-assistant-prod

# API URL (Change to your domain)
API_URL=https://api.yourdomain.com
EOF
    echo -e "${GREEN}✅ Created .env.production${NC}"
    echo -e "${YELLOW}⚠️  IMPORTANT: Edit .env.production with your passwords!${NC}"
    exit 1
fi

# Load environment
export $(grep -v '^#' .env.production | xargs)

echo ""
echo -e "${GREEN}📦 Building Docker images...${NC}"
docker compose -f docker-compose.prod.yml build

echo ""
echo -e "${GREEN}🚀 Starting containers...${NC}"
docker compose -f docker-compose.prod.yml up -d

echo ""
echo -e "${GREEN}⏳ Waiting for database...${NC}"
sleep 10

# Run Prisma migrations
echo ""
echo -e "${GREEN}🔧 Running database migrations...${NC}"
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Your services are running at:"
echo "  - Frontend: http://localhost:80"
echo "  - Backend API: http://localhost:3001"
echo "  - MinIO Console: http://localhost:9001"
echo ""
echo "Use Cloudflare Tunnel or nginx to expose to internet."
