#!/usr/bin/env bash
# Orbit local development runner using the project-local conda env.
#
# Usage:
#   ./dev_conda.sh                # Start Docker plus all services
#   ./dev_conda.sh --skip-docker  # Start app services only
#
# Stop: Ctrl+C

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONDA_DIR="$ROOT/.conda"
PNPM_STORE_DIR="$ROOT/.pnpm-store"

# Colors
RESET='\033[0m'; BOLD='\033[1m'
C_CYAN='\033[0;36m'; C_GREEN='\033[0;32m'
C_MAGENTA='\033[0;35m'
C_YELLOW='\033[0;33m'; C_RED='\033[0;31m'

step() { printf "\n${BOLD}${C_CYAN}> %s${RESET}\n" "$*"; }
info() { printf "  ${C_GREEN}%s${RESET}\n" "$*"; }
warn() { printf "  ${C_YELLOW}WARNING: %s${RESET}\n" "$*"; }
die()  { printf "  ${C_RED}ERROR: %s${RESET}\n" "$*" >&2; exit 1; }

tag() {
    local label=$1 color=$2
    while IFS= read -r line || [[ -n "$line" ]]; do
        printf "${color}[%-8s]${RESET} %s\n" "$label" "$line"
    done
}

PIDS=()

cleanup() {
    printf "\n${C_YELLOW}Shutting down...${RESET}\n"
    for pid in "${PIDS[@]:-}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    printf "${C_GREEN}All stopped.${RESET}\n"
}
trap cleanup EXIT INT TERM

SKIP_DOCKER=false
for arg in "$@"; do
    case "$arg" in
        --skip-docker) SKIP_DOCKER=true ;;
        *) die "Unknown argument: $arg" ;;
    esac
done

[[ -x "$CONDA_DIR/bin/python" ]] || die "Missing conda env: $CONDA_DIR"
[[ -x "$CONDA_DIR/bin/uvicorn" ]] || die "Missing backend dependency: uvicorn"
[[ -x "$CONDA_DIR/bin/pnpm" ]] || die "Missing Node package manager: pnpm"
[[ -x "$ROOT/extension/node_modules/.bin/wxt" ]] || die "Missing extension deps: run pnpm install in extension"
"$CONDA_DIR/bin/python" -c "import greenlet" >/dev/null 2>&1 || die "Missing backend dependency: greenlet"

export PATH="$CONDA_DIR/bin:$PATH"
export CONDA_PREFIX="$CONDA_DIR"
export PNPM_HOME="$CONDA_DIR/bin"
export npm_config_store_dir="$PNPM_STORE_DIR"
info "conda: $CONDA_DIR"

if ! $SKIP_DOCKER; then
    step "Docker (postgres / qdrant / redis)"

    docker compose -f "$ROOT/docker-compose.yml" up -d \
        || die "docker compose up failed. Check whether Docker Desktop is running."

    printf "  Waiting for PostgreSQL "
    ready=false
    for _ in $(seq 1 30); do
        sleep 1; printf "."
        pg_id=$(docker compose -f "$ROOT/docker-compose.yml" ps -q postgres 2>/dev/null || true)
        if [[ -n "$pg_id" ]] && docker exec "$pg_id" pg_isready -U orbit -q 2>/dev/null; then
            ready=true; break
        fi
    done
    printf "\n"
    $ready && info "PostgreSQL ready" || warn "PostgreSQL did not respond; backend may retry"
fi

step "Backend (FastAPI :8000)"
(
    cd "$ROOT/backend"
    exec "$CONDA_DIR/bin/uvicorn" app.main:app --reload --host 0.0.0.0 --port 8000 2>&1
) | tag "backend" "$C_GREEN" &
PIDS+=($!)

step "Extension (WXT)"
(
    cd "$ROOT/extension"
    exec ./node_modules/.bin/wxt 2>&1
) | tag "ext" "$C_MAGENTA" &
PIDS+=($!)

printf "\n"
printf "  ${C_GREEN}${BOLD}All services running with .conda${RESET}\n\n"
printf "  Backend   ${C_CYAN}http://localhost:8000${RESET}\n"
printf "  API Docs  ${C_CYAN}http://localhost:8000/docs${RESET}\n"
printf "  Extension extension/.output/chrome-mv3-dev\n"
printf "            chrome://extensions > Developer mode > Load unpacked\n\n"
printf "  ${C_YELLOW}Ctrl+C stops all services${RESET}\n\n"

wait
