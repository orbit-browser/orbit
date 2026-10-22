#!/usr/bin/env bash
# 백업 한 묶음으로 Postgres 와 Qdrant 를 되돌린다. 지금 데이터는 덮어써진다.
#   ./restore.sh backups/20261022T033000Z
set -euo pipefail
cd "$(dirname "$0")"

SRC="${1:?usage: ./restore.sh backups/<STAMP>}"
[[ -f "$SRC/postgres.dump" ]] || { echo "missing $SRC/postgres.dump" >&2; exit 1; }
DC=(docker compose -f docker-compose.prod.yml --env-file .env.production)
SNAPSHOT_PY="$(cat qdrant_snapshot.py)"
trap 'echo "restore FAILED: caddy/backend left stopped. fix and rerun, or: docker compose ... start backend caddy" >&2' ERR

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
