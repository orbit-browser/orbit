#!/usr/bin/env bash
# Orbit 로컬 개발 환경 일괄 시작
#
# 사용법:
#   ./dev.sh                # Docker 포함 전체 기동
#   ./dev.sh --skip-docker  # Docker가 이미 실행 중인 경우
#
# 종료: Ctrl+C (모든 서비스 동시 종료)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── ANSI 색상 ────────────────────────────────────────────────────────
RESET='\033[0m'; BOLD='\033[1m'
C_CYAN='\033[0;36m'; C_GREEN='\033[0;32m'
C_MAGENTA='\033[0;35m'
C_YELLOW='\033[0;33m'; C_RED='\033[0;31m'

step() { printf "\n${BOLD}${C_CYAN}> %s${RESET}\n" "$*"; }
info() { printf "  ${C_GREEN}%s${RESET}\n" "$*"; }
warn() { printf "  ${C_YELLOW}WARNING: %s${RESET}\n" "$*"; }
die()  { printf "  ${C_RED}ERROR: %s${RESET}\n" "$*" >&2; exit 1; }

# 각 서비스 출력에 색상 prefix 붙이기
# 사용: some_command 2>&1 | tag "label" "$COLOR" &
tag() {
    local label=$1 color=$2
    while IFS= read -r line || [[ -n "$line" ]]; do
        printf "${color}[%-8s]${RESET} %s\n" "$label" "$line"
    done
}

# ── 프로세스 추적 및 정리 ──────────────────────────────────────────────
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

# ── 인자 파싱 ────────────────────────────────────────────────────────
SKIP_DOCKER=false
for arg in "$@"; do
    case "$arg" in
        --skip-docker) SKIP_DOCKER=true ;;
        *) die "Unknown argument: $arg" ;;
    esac
done

# ── 1. Docker ────────────────────────────────────────────────────────
if ! $SKIP_DOCKER; then
    step "Docker (postgres · qdrant)"

    docker compose -f "$ROOT/docker-compose.yml" up -d \
        || die "docker compose up 실패 — Docker Desktop이 실행 중인지 확인하세요"

    printf "  PostgreSQL 준비 대기 중 "
    ready=false
    for _ in $(seq 1 30); do
        sleep 1; printf "."
        pg_id=$(docker compose -f "$ROOT/docker-compose.yml" ps -q postgres 2>/dev/null || true)
        if [[ -n "$pg_id" ]] && docker exec "$pg_id" pg_isready -U orbit -q 2>/dev/null; then
            ready=true; break
        fi
    done
    printf "\n"
    $ready && info "PostgreSQL Ready" || warn "응답 없음 — 백엔드가 자체 재시도합니다"
fi

# ── 2. 가상환경 탐색 ──────────────────────────────────────────────────
VENV_ACTIVATE=""
for candidate in ".venv/bin/activate" "venv/bin/activate" \
                 ".venv/Scripts/activate" "venv/Scripts/activate"; do
    if [[ -f "$ROOT/backend/$candidate" ]]; then
        VENV_ACTIVATE="$ROOT/backend/$candidate"
        info "venv: backend/$candidate"
        break
    fi
done
[[ -z "$VENV_ACTIVATE" ]] && warn "가상환경 없음 — 시스템 Python 사용"

# ── 3. Backend ───────────────────────────────────────────────────────
step "Backend (FastAPI :8000)"
(
    cd "$ROOT/backend"
    # shellcheck source=/dev/null
    [[ -n "$VENV_ACTIVATE" ]] && source "$VENV_ACTIVATE"
    exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 2>&1
) | tag "backend" "$C_GREEN" &
PIDS+=($!)

# ── 4. Extension ─────────────────────────────────────────────────────
step "Extension (WXT)"
(
    cd "$ROOT/extension"
    exec pnpm dev 2>&1
) | tag "ext" "$C_MAGENTA" &
PIDS+=($!)

# ── 완료 안내 ────────────────────────────────────────────────────────
printf "\n"
printf "  ${C_GREEN}${BOLD}All services running${RESET}\n\n"
printf "  Backend   ${C_CYAN}http://localhost:8000${RESET}\n"
printf "  API Docs  ${C_CYAN}http://localhost:8000/docs${RESET}\n"
printf "  Extension extension/.output/chrome-mv3-dev\n"
printf "            chrome://extensions > 개발자 모드 > 압축 해제된 확장 로드\n\n"
printf "  ${C_YELLOW}Ctrl+C 로 전체 종료${RESET}\n\n"

wait
