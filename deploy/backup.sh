#!/usr/bin/env bash
# Postgres 덤프와 Qdrant 스냅샷을 $BACKUP_DIR/<시각>/ 에 받고, 최근 KEEP 개만 남긴다.
# cron 예: 30 3 * * * cd /opt/orbit/deploy && ./backup.sh >> backups/backup.log 2>&1
# 노트북 모드: ENV_FILE=.env.laptop BACKUP_DIR=~/OrbitLaptopBackups ./backup.sh
set -euo pipefail
cd "$(dirname "$0")"

KEEP="${KEEP:-14}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
DC=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$STAMP"
SNAPSHOT_PY="$(cat qdrant_snapshot.py)"

umask 077
mkdir -p "$DEST"

"${DC[@]}" exec -T postgres pg_dump -U orbit -d orbit -Fc > "$DEST/postgres.dump"

for name in $("${DC[@]}" exec -T backend python -c "$SNAPSHOT_PY" list); do
    "${DC[@]}" exec -T backend python -c "$SNAPSHOT_PY" dump "$name" > "$DEST/qdrant-$name.snapshot"
done

# 빈 파일은 실패한 백업이다. 성공처럼 남기지 않는다.
for f in "$DEST"/*; do
    [[ -s "$f" ]] || { echo "backup failed: empty $f" >&2; exit 1; }
done
echo "backup ok: $DEST ($(du -sh "$DEST" | cut -f1))"

ls -1d "$BACKUP_DIR"/2*/ 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do rm -rf "$old"; done
