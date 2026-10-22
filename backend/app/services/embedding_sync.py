import argparse
import asyncio
import logging
import re
from collections import defaultdict
from collections.abc import Sequence
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.engine import make_url

from ..ai.embedding import embed
from ..config import settings
from ..db.models import Session as SessionModel
from ..db.session import AsyncSessionLocal
from ..db.vector import COLLECTION, point_ids_missing_owner, set_owner, upsert_point
from ..schemas.session import SessionSummary
from .event_filter import ai_safe_path

logger = logging.getLogger(__name__)


_PATH_TOKEN = re.compile(r"[^\W_]+")


def _page_terms(tab: dict) -> str:
    """페이지 제목 + 도메인 + 경로 토큰. 여러 주제가 섞인 LLM 요약에서도 페이지 단위 질문이 걸리게 한다."""
    url = tab.get("url") or ""
    try:
        parts = urlsplit(url)
    except ValueError:
        parts = urlsplit("")
    host = (parts.hostname or "").removeprefix("www.")
    # 긴 숫자 id(CNTS_000000000022574 등)는 의미가 없어 뺀다. 5070 같은 짧은 모델 번호는 남긴다.
    path = " ".join(t for t in _PATH_TOKEN.findall(ai_safe_path(url)) if not (t.isdigit() and len(t) > 6))
    return " ".join(part for part in ((tab.get("title") or "").strip(), host, path) if part)


def build_embedding_text(title: str, summary: SessionSummary, tabs: Sequence[dict] = ()) -> str:
    parts = [title, summary.overview, summary.purpose, *summary.highlights, *(_page_terms(t) for t in tabs)]
    return " ".join(part.strip() for part in parts if part.strip())


async def embed_and_upsert(session_id: str, title: str, summary: SessionSummary) -> None:
    """요약 텍스트를 embedding-passage로 임베딩해 Qdrant에 반영. 요약 성공 여부와 독립적으로 상태를 추적."""
    try:
        async with AsyncSessionLocal() as db:
            row = (
                await db.execute(
                    select(SessionModel.user_id, SessionModel.tabs).where(SessionModel.id == session_id)
                )
            ).first()
        if row is None:
            return  # 그 사이 삭제된 세션 — 고아 포인트를 만들지 않는다
        user_id, tabs = row
        embed_text = build_embedding_text(title, summary, tabs or [])
        vector = await embed(embed_text, model=settings.embedding_passage_model)
        await upsert_point(session_id, vector, {
            "session_id": session_id,
            "user_id": user_id,
            "title": title,
            "overview": summary.overview,
            "purpose": summary.purpose,
        })
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.embedding_status = "done"
                await db.commit()
    except Exception as exc:
        logger.warning("임베딩/Qdrant upsert 실패 (session_id=%s): %s", session_id, exc)
        async with AsyncSessionLocal() as db:
            session = await db.get(SessionModel, session_id)
            if session:
                session.embedding_status = "failed"
                await db.commit()


async def backfill_owner_payload() -> None:
    """소유자 payload가 없는 기존 포인트에 `user_id`를 채운다. 기동 시 실행하며 멱등이다.

    DB에 없는 세션의 포인트는 그대로 둔다 — 소유자 필터에 걸리지 않으므로 검색에 나오지 않는다.
    """
    try:
        missing = await point_ids_missing_owner()
        if not missing:
            return
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(SessionModel.id, SessionModel.user_id).where(SessionModel.id.in_(missing))
                )
            ).all()
        by_owner: dict[str, list[str]] = defaultdict(list)
        for session_id, user_id in rows:
            by_owner[user_id].append(session_id)
        for user_id, session_ids in by_owner.items():
            await set_owner(user_id, session_ids)
        logger.info(
            "Qdrant 소유자 payload backfill: %d건 반영, DB에 없는 포인트 %d건 유지",
            len(rows), len(missing) - len(rows),
        )
    except Exception as exc:
        logger.warning("Qdrant 소유자 payload backfill 실패 (%s) — 다음 기동 때 재시도", exc)


def _reembed_query(user_id: str | None):
    query = select(SessionModel.id, SessionModel.title, SessionModel.summary).where(
        SessionModel.summary_status == "done"
    )
    if user_id:
        query = query.where(SessionModel.user_id == user_id)
    return query


async def count_reembed_targets(user_id: str | None = None) -> int:
    async with AsyncSessionLocal() as db:
        return len((await db.execute(_reembed_query(user_id))).all())


async def reembed_sessions(user_id: str | None = None) -> int:
    """요약이 끝난 세션을 현재 임베딩 텍스트 구성으로 다시 임베딩한다(텍스트 구성을 바꾼 뒤 백필용).

    세션마다 임베딩 호출 1회. 순차 실행해 외부 API 제한을 넘지 않는다. 처리한 세션 수를 반환한다.
    """
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(_reembed_query(user_id))).all()
    done = 0
    for session_id, title, summary in rows:
        try:
            parsed = SessionSummary(**(summary or {}))
        except ValueError:
            logger.warning("Re-embedding skipped: invalid summary (session_id=%s)", session_id)
            continue
        await embed_and_upsert(session_id, title, parsed)
        done += 1
    logger.info("Session re-embedding finished: %d of %d sessions", done, len(rows))
    return done


def _target_description() -> str:
    # 비밀번호가 든 URL을 그대로 찍지 않는다. 호스트·DB 이름·컬렉션만 보여 준다.
    db_url = make_url(settings.database_url)
    qdrant = urlsplit(settings.qdrant_url)
    return (
        f"database={db_url.host}:{db_url.port or ''}/{db_url.database} "
        f"qdrant={qdrant.hostname}:{qdrant.port or ''} collection={COLLECTION}"
    )


def main(argv: Sequence[str] | None = None) -> int:
    # 유료 임베딩을 세션 수만큼 부르므로, 대상을 명시하고 확인(--yes)한 뒤에만 실행한다.
    parser = argparse.ArgumentParser(description="Re-embed summarized sessions into Qdrant (paid API).")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--user-id", help="only this user's sessions")
    scope.add_argument("--all", action="store_true", help="every user's sessions")
    parser.add_argument("--dry-run", action="store_true", help="print the target and count, then exit")
    parser.add_argument("--yes", action="store_true", help="run without stopping for confirmation")
    args = parser.parse_args(argv)
    if args.user_id is not None and not args.user_id.strip():
        parser.error("--user-id must not be empty")  # 빈 값이 전체 대상으로 새지 않게 한다
    logging.basicConfig(level=logging.INFO)

    return asyncio.run(_run_backfill(None if args.all else args.user_id, args.dry_run, args.yes))


async def _run_backfill(user_id: str | None, dry_run: bool, yes: bool) -> int:
    # 한 이벤트 루프에서 끝낸다. asyncpg 풀은 처음 쓴 루프에 묶인다.
    count = await count_reembed_targets(user_id)
    print(f"target: {_target_description()} user={user_id or 'ALL'} sessions={count}")
    if dry_run:
        print("dry run: no embedding calls made")
        return 0
    if not yes:
        print(f"stopped: rerun with --yes to make {count} paid embedding calls")
        return 1
    print(f"re-embedded {await reembed_sessions(user_id)} sessions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
