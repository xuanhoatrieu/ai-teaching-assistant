#!/bin/bash
# AI Teaching Assistant - Rollback Script
# Usage: ./rollback.sh [version]
# Example: ./rollback.sh v1.0.0 or ./rollback.sh sha-abc1234

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Config
COMPOSE_FILE="docker-compose.registry.yml"
HISTORY_FILE=".deploy-history"

# Load environment
if [ -f .env.production ]; then
    export $(grep -v '^#' .env.production | xargs)
fi

# Functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_history() {
    echo ""
    echo "📋 Deployment History (last 10):"
    echo "================================"
    if [ -f "$HISTORY_FILE" ]; then
        tail -10 "$HISTORY_FILE" | nl -w2 -s'. '
    else
        echo "No deployment history found."
    fi
    echo ""
}

get_current_version() {
    docker inspect ai-teaching-backend --format='{{.Config.Image}}' 2>/dev/null | cut -d':' -f2 || echo "unknown"
}

rollback_to() {
    local version=$1
    
    log_info "Rolling back to version: $version"
    
    # Save current version before rollback
    local current=$(get_current_version)
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Rollback from $current to $version" >> "$HISTORY_FILE"
    
    # Update images to specific version
    export BACKEND_TAG="$version"
    export FRONTEND_TAG="$version"
    
    # Pull specific version
    log_info "Pulling images with tag: $version"
    docker compose -f "$COMPOSE_FILE" pull backend frontend
    
    # Restart with new version
    log_info "Restarting containers..."
    docker compose -f "$COMPOSE_FILE" up -d backend frontend
    
    # Wait and verify
    sleep 5
    
    local new_version=$(get_current_version)
    if [ "$new_version" == "$version" ]; then
        log_info "✅ Rollback successful! Now running: $version"
    else
        log_error "Rollback may have failed. Current version: $new_version"
        exit 1
    fi
}

# Main
echo ""
echo "🔄 AI Teaching Assistant - Rollback Tool"
echo "========================================="
echo ""

current=$(get_current_version)
log_info "Current version: $current"

if [ -n "$1" ]; then
    # Version provided as argument
    rollback_to "$1"
else
    # Interactive mode
    show_history
    
    echo "Available actions:"
    echo "1) Show available tags from registry"
    echo "2) Enter version manually"
    echo "3) Cancel"
    echo ""
    read -p "Choose (1-3): " choice
    
    case $choice in
        1)
            log_info "Fetching tags from registry..."
            # Note: requires gh CLI or curl with auth
            echo "Please check GitHub Packages for available tags:"
            echo "https://github.com/orgs/YOUR_ORG/packages"
            ;;
        2)
            read -p "Enter version (e.g., v1.0.0, main, sha-abc123): " version
            rollback_to "$version"
            ;;
        3)
            log_info "Cancelled."
            exit 0
            ;;
        *)
            log_error "Invalid choice."
            exit 1
            ;;
    esac
fi
