#!/usr/bin/env bash
# 백업 한 묶음으로 Postgres 와 Qdrant 를 되돌린다. 지금 데이터는 덮어써진다.
#   ./restore.sh backups/20261022T033000Z
# 노트북 모드: ENV_FILE=.env.laptop BACKUP_DIR=~/OrbitLaptopBackups ./restore.sh <묶음>
# 덮어쓰기 전에 지금 상태를 pre-restore-<시각> 묶음으로 먼저 받는다(잘못 고른 묶음을 되돌릴 수 있게).
# 이 묶음은 정기 정리(날짜 이름 2*만 지움) 대상이 아니라 직접 지울 때까지 남는다.
set -euo pipefail
cd "$(dirname "$0")"

SRC="${1:?usage: ./restore.sh backups/<STAMP>}"
[[ -f "$SRC/postgres.dump" ]] || { echo "missing $SRC/postgres.dump" >&2; exit 1; }
ENV_FILE="${ENV_FILE:-.env.production}"
export ENV_FILE
DC=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
SNAPSHOT_PY="$(cat qdrant_snapshot.py)"

# 서버가 망가져 백업이 안 될 때만 SKIP_SAFETY_BACKUP=1 로 건너뛴다.
if [[ "${SKIP_SAFETY_BACKUP:-0}" != 1 ]]; then
    trap 'echo "restore aborted: safety backup failed, nothing was stopped or changed" >&2' ERR
    BACKUP_NAME="pre-restore-$(date -u +%Y%m%dT%H%M%SZ)" ./backup.sh
fi

trap 'echo "restore FAILED midway: caddy/backend are stopped and data may be partial. fix and rerun, or: docker compose ... start backend caddy" >&2' ERR

# 복구하는 동안 요청과 주기 동기화가 들어오지 않게 프록시와 백엔드를 내린다.
"${DC[@]}" stop caddy backend

"${DC[@]}" exec -T postgres pg_restore -U orbit -d orbit --clean --if-exists --no-owner < "$SRC/postgres.dump"

for f in "$SRC"/qdrant-*.snapshot; do
    [[ -e "$f" ]] || continue
    name="$(basename "$f" .snapshot)"; name="${name#qdrant-}"
    "${DC[@]}" run --rm --no-deps -T backend python -c "$SNAPSHOT_PY" load "$name" < "$f"
done

# 시작할 때 멱등 마이그레이션이 다시 돌아 옛 백업의 빠진 컬럼을 채운다.
"${DC[@]}" start backend caddy
echo "restore ok: $SRC"
