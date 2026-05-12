#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AI Teaching Assistant — Start All Services
# Run: ./start.sh          (start all)
#      ./start.sh stop     (stop all)
#      ./start.sh status   (check status)
# ═══════════════════════════════════════════════════════════════

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDS_DIR="$BASE_DIR/.pids"
LOGS_DIR="$BASE_DIR/.logs"
mkdir -p "$PIDS_DIR" "$LOGS_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Service definitions ──
start_backend() {
    echo -e "${BLUE}🔧 Starting Backend (NestJS :3001)...${NC}"
    cd "$BASE_DIR/backend"
    nohup npm run start:dev > "$LOGS_DIR/backend.log" 2>&1 &
    echo $! > "$PIDS_DIR/backend.pid"
    echo -e "${GREEN}   ✅ Backend PID: $!${NC}"
}

start_frontend() {
    echo -e "${BLUE}🎨 Starting Frontend (Vite :5173)...${NC}"
    cd "$BASE_DIR/frontend"
    nohup npm run dev > "$LOGS_DIR/frontend.log" 2>&1 &
    echo $! > "$PIDS_DIR/frontend.pid"
    echo -e "${GREEN}   ✅ Frontend PID: $!${NC}"
}

start_pptx() {
    echo -e "${BLUE}📄 Starting PPTX Service (Uvicorn :3002)...${NC}"
    cd "$BASE_DIR/backend/utils/pptx_generator"
    nohup "$BASE_DIR/backend/utils/pptx_generator/venv/bin/uvicorn" main:app --port 3002 > "$LOGS_DIR/pptx.log" 2>&1 &
    echo $! > "$PIDS_DIR/pptx.pid"
    echo -e "${GREEN}   ✅ PPTX PID: $!${NC}"
}

start_worker() {
    echo -e "${BLUE}🎬 Starting Vid-Worker (Python)...${NC}"
    cd "$BASE_DIR/vid-worker"
    nohup "$BASE_DIR/vid-worker/venv/bin/python" worker.py > "$LOGS_DIR/vid-worker.log" 2>&1 &
    echo $! > "$PIDS_DIR/worker.pid"
    echo -e "${GREEN}   ✅ Worker PID: $!${NC}"
}

# ── Stop all services ──
stop_all() {
    echo -e "${YELLOW}⏹️  Stopping all services...${NC}"
    for svc in backend frontend pptx worker; do
        pidfile="$PIDS_DIR/$svc.pid"
        if [ -f "$pidfile" ]; then
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                # Kill the process group to catch child processes
                kill -- -$(ps -o pgid= -p "$pid" | tr -d ' ') 2>/dev/null || kill "$pid" 2>/dev/null
                echo -e "   ${RED}⛔ Stopped $svc (PID: $pid)${NC}"
            else
                echo -e "   ${YELLOW}⚠️  $svc already stopped${NC}"
            fi
            rm -f "$pidfile"
        fi
    done
    # Also kill any leftover processes on our ports
    for port in 3001 3002 5173; do
        pids=$(lsof -ti :$port 2>/dev/null)
        if [ -n "$pids" ]; then
            echo "$pids" | xargs kill 2>/dev/null
            echo -e "   ${RED}⛔ Killed processes on port $port${NC}"
        fi
    done
    # Kill any stale worker.py processes (from old sessions)
    stale_workers=$(pgrep -f "vid-worker.*worker.py" 2>/dev/null)
    if [ -n "$stale_workers" ]; then
        echo "$stale_workers" | xargs kill 2>/dev/null
        echo -e "   ${RED}⛔ Killed stale worker.py processes${NC}"
    fi
    echo -e "${GREEN}✅ All services stopped${NC}"
}

# ── Check status ──
check_status() {
    echo -e "${BLUE}📊 Service Status:${NC}"
    echo "─────────────────────────────────────"
    for svc_info in "backend:3001:NestJS" "frontend:5173:Vite" "pptx:3002:Uvicorn" "worker:0:Vid-Worker"; do
        svc=$(echo "$svc_info" | cut -d: -f1)
        port=$(echo "$svc_info" | cut -d: -f2)
        label=$(echo "$svc_info" | cut -d: -f3)
        pidfile="$PIDS_DIR/$svc.pid"

        if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
            pid=$(cat "$pidfile")
            echo -e "   ${GREEN}✅ $label${NC} → :$port (PID: $pid)"
        elif [ "$port" -ne 0 ] && lsof -i :$port -sTCP:LISTEN > /dev/null 2>&1; then
            echo -e "   ${YELLOW}⚠️  $label${NC} → :$port (running, not managed)"
        elif [ "$port" -eq 0 ]; then
            echo -e "   ${RED}❌ $label${NC} (stopped)"
        else
            echo -e "   ${RED}❌ $label${NC} → :$port (stopped)"
        fi
    done
    echo "─────────────────────────────────────"
    echo -e "${BLUE}📝 Logs: ${NC}$LOGS_DIR/"
    echo "   tail -f $LOGS_DIR/backend.log"
    echo "   tail -f $LOGS_DIR/frontend.log"
    echo "   tail -f $LOGS_DIR/pptx.log"
}

# ── Main ──
case "${1:-start}" in
    start)
        echo ""
        echo -e "${GREEN}🚀 AI Teaching Assistant — Starting All Services${NC}"
        echo "═══════════════════════════════════════════════════"
        # Stop any existing instances first
        stop_all 2>/dev/null
        echo ""

        start_backend
        start_frontend
        start_pptx
        start_worker

        echo ""
        echo "═══════════════════════════════════════════════════"
        echo -e "${GREEN}✅ All services started!${NC}"
        echo ""
        echo -e "   🔧 Backend:   ${BLUE}http://localhost:3001${NC}"
        echo -e "   🎨 Frontend:  ${BLUE}http://localhost:5173${NC}"
        echo -e "   📄 PPTX:      ${BLUE}http://localhost:3002${NC}"
        echo -e "   🎬 Worker:    ${GREEN}vid-worker (Redis queue)${NC}"
        echo ""
        echo -e "   📝 Logs: tail -f $LOGS_DIR/*.log"
        echo -e "   ⏹️  Stop: ${YELLOW}./start.sh stop${NC}"
        echo -e "   📊 Status: ${YELLOW}./start.sh status${NC}"
        echo ""

        # Wait a moment then check
        sleep 3
        check_status
        ;;
    stop)
        stop_all
        ;;
    status)
        check_status
        ;;
    restart)
        stop_all
        echo ""
        exec "$0" start
        ;;
    logs)
        tail -f "$LOGS_DIR"/*.log
        ;;
    *)
        echo "Usage: ./start.sh [start|stop|status|restart|logs]"
        exit 1
        ;;
esac
