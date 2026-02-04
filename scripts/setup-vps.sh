#!/bin/bash
# AI Teaching Assistant - First Time VPS Setup
# Run this script ONCE on your Ubuntu VPS

set -e

echo "🚀 AI Teaching Assistant - VPS Setup"
echo "====================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Install Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo -e "${GREEN}✅ Docker installed. Please logout and login again.${NC}"
fi

# Create app directory
APP_DIR="/home/$USER/ai-teaching-assistant"
mkdir -p $APP_DIR
cd $APP_DIR

# Download compose file
echo "Downloading docker-compose.registry.yml..."
curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO:-your-username/ai-teaching-assistant}/main/docker-compose.registry.yml -o docker-compose.yml

# Download scripts
mkdir -p scripts
curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO:-your-username/ai-teaching-assistant}/main/scripts/rollback.sh -o scripts/rollback.sh
chmod +x scripts/rollback.sh

# Create .env.production if not exists
if [ ! -f .env.production ]; then
    echo "Creating .env.production..."
    curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO:-your-username/ai-teaching-assistant}/main/.env.production.example -o .env.production
    echo -e "${YELLOW}⚠️  IMPORTANT: Edit .env.production with your values!${NC}"
    echo "   nano .env.production"
fi

# Login to GitHub Container Registry
echo ""
echo -e "${YELLOW}Login to GitHub Container Registry:${NC}"
echo "1. Create a GitHub Personal Access Token (PAT) with 'read:packages' scope"
echo "2. Run: echo YOUR_PAT | docker login ghcr.io -u YOUR_USERNAME --password-stdin"
echo ""

echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Edit .env.production with your passwords"
echo "2. Login to ghcr.io (see above)"
echo "3. Run: docker compose up -d"
