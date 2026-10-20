"""사용자 폴더 자동 분류 (docs/api-design-v2.md §13.4, docs/DecisionLog.md 2026-10-20).

폴더는 사용자만 만든다. 세션과 가장 비슷한 폴더를 그 폴더에 사용자가 넣은 세션들의 벡터로 고르고, 확실하면 자동으로
넣고(folder_assigned_by='auto') 애매하면 제안만 한다. 자동 배정 세션은 근거에서 빼서 잘못 넣은 세션이 다음 판단을
끌고 가지 않게 한다. 사용자가 정한 세션(folder_assigned_by='user')과 이미 폴더에 있는 세션은 건드리지 않는다.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import Folder, Session as SessionModel
from ..db.session import AsyncSessionLocal
from ..db.vector import get_vectors, score_sessions_many

# 폴더 점수 = 그 폴더 근거 세션 중 가장 비슷한 2개의 평균. 한 세션만 닮은 우연을 줄이면서 갈래가 여러 개인 폴더
# (이직 = 공고 + 면접 후기)도 평균 벡터보다 잘 맞춘다.
TOP_MEMBERS = 2
# ponytail: real-eval 21세션 leave-one-out + ask-eval 8세션 실측(2026-10-20). 폴더가 있는 세션 0.394~0.580,
# 폴더 없는 세션 최고 0.27~0.36, 애매한 다른 여행(제주→강릉) 0.447. 근거 세션이 하나뿐인 폴더는 최고 점수만 보여
# 무관한 세션이 0.386까지 올라(김치찌개 → 맛집이 섞인 강릉 여행) 제안 기준은 0.40. 데이터가 늘면 재조정.
AUTO_MIN_SCORE = 0.47
AUTO_MIN_MARGIN = 0.12
AUTO_MIN_MEMBERS = 2
SUGGEST_MIN_SCORE = 0.40
# 근거·제안 대상 상한(최근 활동 순). 한 번에 Qdrant에 보내는 id 수를 묶어 둔다.
MAX_EVIDENCE_SESSIONS = 500
MAX_SUGGESTION_SESSIONS = 50
logger = logging.getLogger(__name__)

Decision = Literal["auto", "suggest"]


@dataclass(frozen=True)
class FolderMatch:
    folder_id: str
    score: float
    # 2위 폴더 점수와의 차이. 폴더가 하나뿐이면 점수 그대로다.
    margin: float
    members: int
    similar_session_ids: list[str]


def best_folder(scores: dict[str, float], folder_of: dict[str, str]) -> FolderMatch | None:
    """근거 세션별 유사도로 가장 가까운 폴더를 고른다."""
    by_folder: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for session_id, score in scores.items():
        if folder_id := folder_of.get(session_id):
            by_folder[folder_id].append((score, session_id))
    ranked: list[tuple[float, str, int, list[str]]] = []
    for folder_id, items in by_folder.items():
        items.sort(reverse=True)
        top = items[:TOP_MEMBERS]
        ranked.append((sum(score for score, _ in top) / len(top), folder_id, len(items), [sid for _, sid in top]))
    if not ranked:
        return None
    ranked.sort(key=lambda item: item[0], reverse=True)
    score, folder_id, members, similar = ranked[0]
    second = ranked[1][0] if len(ranked) > 1 else 0.0
    return FolderMatch(folder_id, score, score - second, members, similar)


def decide(match: FolderMatch | None) -> Decision | None:
    if match is None or match.score < SUGGEST_MIN_SCORE:
        return None
    if match.score >= AUTO_MIN_SCORE and match.margin >= AUTO_MIN_MARGIN and match.members >= AUTO_MIN_MEMBERS:
        return "auto"
    return "suggest"


async def _evidence(db: AsyncSession, user_id: str) -> dict[str, str]:
    """사용자가 폴더에 넣은 세션 → 폴더 id. 기능 이전 배정(NULL)도 사용자가 넣은 것이다. 지워진 폴더 id는 뺀다."""
    result = await db.execute(
        select(SessionModel.id, SessionModel.folder_id)
        .where(
            SessionModel.user_id == user_id,
            SessionModel.status != "merged",
            SessionModel.folder_id.in_(select(Folder.id).where(Folder.user_id == user_id)),
            or_(SessionModel.folder_assigned_by.is_(None), SessionModel.folder_assigned_by == "user"),
        )
        .order_by(SessionModel.last_activity_at.desc().nulls_last())
        .limit(MAX_EVIDENCE_SESSIONS)
    )
    return {session_id: folder_id for session_id, folder_id in result.all()}


def _undecided(user_id: str):
    # 재요약이 실패하면 embedding_status는 done으로 남지만 벡터는 이벤트가 붙기 전 것이다 — 요약까지 성공한 세션만 본다.
    return (
        SessionModel.user_id == user_id,
        SessionModel.status != "merged",
        SessionModel.summary_status == "done",
        SessionModel.embedding_status == "done",
        SessionModel.folder_id.is_(None),
        SessionModel.folder_assigned_by.is_(None),
    )


async def _matches(
    session_ids: list[str], folder_of: dict[str, str], user_id: str
) -> dict[str, FolderMatch | None]:
    """세션마다 가장 가까운 폴더. Qdrant 요청은 벡터 조회 1번·점수 1번으로 묶는다. 벡터가 없는 세션(임베딩 전)은 빠진다."""
    vectors = await get_vectors(session_ids)
    scores = await score_sessions_many(vectors, list(folder_of), user_id=user_id)
    return {session_id: best_folder(scores.get(session_id, {}), folder_of) for session_id in vectors}


async def _file_if_undecided(db: AsyncSession, session_id: str, folder_id: str, user_id: str) -> bool:
    """Qdrant를 기다리는 사이 사용자가 옮기거나 제안을 닫았거나 폴더를 지웠으면 덮어쓰지 않는다 — 아직 미결정이고
    폴더가 남아 있을 때만 넣는다. 폴더 행 공유 잠금으로 폴더 삭제(배타 잠금 후 소속 해제)와 순서를 맞춘다."""
    locked = await db.scalar(
        select(Folder.id).where(Folder.id == folder_id, Folder.user_id == user_id).with_for_update(read=True)
    )
    if locked is None:
        return False
    result = await db.execute(
        update(SessionModel)
        .where(SessionModel.id == session_id, *_undecided(user_id))
        .values(folder_id=folder_id, folder_assigned_by="auto")
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1


async def auto_file_sessions(user_id: str, session_ids: set[str]) -> int:
    """배치에서 만들어지거나 바뀐 세션 중 미정리·미결정 세션을 확실할 때만 폴더에 넣는다. 넣은 수를 돌려준다.

    실패해도 배치는 성공으로 끝낸다(부가 기능). 애매한 세션은 그대로 두면 제안 목록에 나온다."""
    if not session_ids:
        return 0
    try:
        async with AsyncSessionLocal() as db:
            folder_of = await _evidence(db, user_id)
            if not folder_of:
                return 0
            result = await db.execute(
                select(SessionModel.id).where(*_undecided(user_id), SessionModel.id.in_(session_ids))
            )
            matches = await _matches(list(result.scalars().all()), folder_of, user_id)
            filed = 0
            for session_id, match in matches.items():
                if decide(match) == "auto" and await _file_if_undecided(db, session_id, match.folder_id, user_id):
                    filed += 1
            await db.commit()
    except Exception as exc:
        logger.warning("폴더 자동 배정 실패 (user_id=%s): %s", user_id, exc)
        return 0
    if filed:
        logger.info("폴더 자동 배정 %d건 (user_id=%s)", filed, user_id)
    return filed


async def folder_suggestions(db: AsyncSession, user_id: str) -> list[tuple[str, FolderMatch]]:
    """미정리·미결정 세션(최근 활동 순 상한)에 폴더를 제안한다. 자동 기준을 넘는 세션도 제안으로만 보여 준다 —
    이미 쌓인 세션은 사용자 모르게 옮기지 않는다. Qdrant 오류는 호출측에 그대로 올린다."""
    folder_of = await _evidence(db, user_id)
    if not folder_of:
        return []
    result = await db.execute(
        select(SessionModel.id)
        .where(*_undecided(user_id))
        .order_by(SessionModel.last_activity_at.desc().nulls_last())
        .limit(MAX_SUGGESTION_SESSIONS)
    )
    matches = await _matches(list(result.scalars().all()), folder_of, user_id)
    suggestions = [(session_id, match) for session_id, match in matches.items() if decide(match) is not None]
    suggestions.sort(key=lambda item: item[1].score, reverse=True)
    return suggestions
