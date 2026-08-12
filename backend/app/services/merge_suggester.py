"""세션 병합 후보 탐지 (merge P1, docs/merge-design.md §3·§6).

읽기 전용 제안만 생성한다 — 어떤 데이터도 변경하지 않는다. 실제 병합(파괴적)은 P2.

후보 조건(사용자 결정 2026-08-07): 벡터 유사도 >= merge_suggest_floor **AND**
키워드/제목 토큰 겹침(정밀 우선). 생존 세션은 이벤트 많은 쪽(동률 시 이른 order_ts, 그다음 id).

판정 로직은 순수 함수(`evaluate_pair` 등, DB/IO 없음)로 두어 합성 데이터로 테스트한다.
"""

import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.models import Session as SessionModel, session_display_title
from ..db.vector import get_vector, search_similar_with_scores
from ..schemas.session import MergeSignal, MergeSuggestion

# 토큰 분리: 공백/구분기호. 한국어는 공백 기준, len>=2만 유효 토큰으로 본다.
_TOKEN_SPLIT = re.compile(r"[\s/·,\-|:()\[\]]+")


@dataclass(frozen=True)
class SessionMeta:
    """순수 판정에 필요한 세션 메타(경량, DB 무관)."""

    id: str
    # 병합 판정(제목 토큰 겹침)의 기준이 되는 내부 이름. 사용자 별칭을 섞지 않는다 —
    # 사용자가 이름을 바꿨다고 병합 후보가 달라지면 안 된다.
    title: str
    keywords: tuple[str, ...]
    event_count: int
    order_ts: datetime  # started_at(없으면 created_at) — 동률 tie-break용
    # 제안 카드에 보여 줄 이름(별칭 우선). 점수에는 쓰지 않는다.
    # 비어 있으면 title로 되돌아간다 — 판정만 검증하는 호출자는 채우지 않아도 된다.
    display_title: str = ""


def _normalize_tokens(values: list[str]) -> set[str]:
    tokens: set[str] = set()
    for value in values:
        for raw in _TOKEN_SPLIT.split(value.lower()):
            tok = raw.strip()
            if len(tok) >= 2:
                tokens.add(tok)
    return tokens


def keyword_overlap(a: SessionMeta, b: SessionMeta) -> list[str]:
    """두 세션의 겹치는 신호를 반환. keywords 교집합 우선, 비면 제목 토큰 교집합.

    빈 리스트면 "겹침 없음"(AND 조건 미충족).
    """
    a_keywords = _normalize_tokens(list(a.keywords))
    b_keywords = _normalize_tokens(list(b.keywords))
    overlap = a_keywords & b_keywords
    if not overlap:
        overlap = _normalize_tokens([a.title]) & _normalize_tokens([b.title])
    return sorted(overlap)


def _pick_survivor(a: SessionMeta, b: SessionMeta) -> tuple[SessionMeta, SessionMeta]:
    """생존(흡수)·피흡수 세션 결정 — event_count desc → order_ts asc → id asc (결정적)."""
    a_key = (-a.event_count, a.order_ts, a.id)
    b_key = (-b.event_count, b.order_ts, b.id)
    return (a, b) if a_key <= b_key else (b, a)


def evaluate_pair(
    a: SessionMeta,
    b: SessionMeta,
    vector_score: float,
    *,
    floor: float,
) -> MergeSuggestion | None:
    """두 세션이 병합 후보이면 제안을, 아니면 None (순수 함수).

    조건: vector_score >= floor AND 키워드/제목 겹침 존재.
    """
    if vector_score < floor:
        return None
    overlap = keyword_overlap(a, b)
    if not overlap:
        return None
    survivor, absorbed = _pick_survivor(a, b)
    return MergeSuggestion(
        survivor_id=survivor.id,
        absorbed_id=absorbed.id,
        survivor_title=survivor.display_title or survivor.title,
        absorbed_title=absorbed.display_title or absorbed.title,
        score=vector_score,
        signals=MergeSignal(vector_score=vector_score, keyword_overlap=overlap),
    )


def _to_meta(session: SessionModel) -> SessionMeta:
    return SessionMeta(
        id=session.id,
        title=session.title or "",
        display_title=session_display_title(session) or "",
        keywords=tuple(str(k) for k in (session.keywords or [])),
        event_count=session.event_count or 0,
        order_ts=session.started_at or session.created_at,
    )


async def find_merge_suggestions(db: AsyncSession, user_id: str) -> list[MergeSuggestion]:
    """활성 세션 쌍을 스캔해 병합 후보를 점수순으로 반환 (읽기 전용, merge P1).

    Qdrant 연결/벡터 부재 시 해당 세션은 조용히 건너뛴다(검색 비활성화와 동일 취급).
    """
    result = await db.execute(
        select(SessionModel).where(
            # 병합 후보는 같은 사용자 세션끼리만 — 없으면 남의 세션과 병합을 제안하게 된다.
            SessionModel.user_id == user_id,
            SessionModel.status == "active",
            SessionModel.embedding_status == "done",
        )
    )
    sessions = list(result.scalars().all())
    metas = {s.id: _to_meta(s) for s in sessions}

    floor = settings.merge_suggest_floor
    # 무순서 쌍 dedupe — frozenset 키에 최고 점수만 유지
    best_score: dict[frozenset[str], float] = {}
    for session in sessions:
        vector = await get_vector(session.id)
        if vector is None:
            continue
        # limit은 상한 여유를 두고 조회, 자기 자신은 제외
        neighbors = await search_similar_with_scores(
            vector, limit=10, score_threshold=floor
        )
        for other_id, score in neighbors:
            if other_id == session.id or other_id not in metas:
                continue
            key = frozenset((session.id, other_id))
            if score > best_score.get(key, -1.0):
                best_score[key] = score

    suggestions: list[MergeSuggestion] = []
    for key, score in best_score.items():
        id_a, id_b = tuple(key)
        suggestion = evaluate_pair(metas[id_a], metas[id_b], score, floor=floor)
        if suggestion is not None:
            suggestions.append(suggestion)

    suggestions.sort(key=lambda s: s.score, reverse=True)
    return suggestions[: settings.merge_suggest_max_pairs]
