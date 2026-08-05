import logging

from .json_utils import extract_json
from .llm import chat_completion

logger = logging.getLogger(__name__)

_SYSTEM = """\
당신은 검색 결과 관련성 전문가입니다.
사용자의 검색 쿼리와 세션 목록을 보고, 쿼리와 관련성이 높은 순으로 인덱스를 재정렬하세요.
반드시 JSON만 반환하세요."""

_USER_TEMPLATE = """\
검색 쿼리: "{query}"

세션 목록:
{lines}

쿼리와의 관련성이 높은 순서로 인덱스를 재정렬하세요.
예시: {{"ranked": [2, 0, 1]}}"""


async def rerank(query: str, sessions: list) -> list:
    """LLM으로 세션 목록을 쿼리 관련성 순으로 재정렬. 실패 시 원래 순서 반환."""
    if len(sessions) <= 1:
        return sessions

    lines = []
    for i, s in enumerate(sessions):
        title = s.title if hasattr(s, "title") else s.get("title", "")
        if hasattr(s, "summary") and s.summary:
            overview = (s.summary.overview or "")[:60]
            purpose = (s.summary.purpose or "")[:60]
            tab_list = s.tabs[:3] if s.tabs else []
            tab_titles = ", ".join(t.title for t in tab_list)
        else:
            summary = s.get("summary") or {}
            overview = (summary.get("overview") or "")[:60]
            purpose = (summary.get("purpose") or "")[:60]
            tab_list = (s.get("tabs") or [])[:3]
            tab_titles = ", ".join(t.get("title", "") for t in tab_list)
        lines.append(f"[{i}] {title} | {overview} | 목적: {purpose} | 탭: {tab_titles}")

    user_msg = _USER_TEMPLATE.format(query=query, lines="\n".join(lines))

    try:
        # 리랭킹은 A.X 경로 사용(DecisionLog 2026-08-05). temperature는 기존 light 경로와 동일하게 유지.
        raw = await chat_completion(_SYSTEM, user_msg, temperature=0.1, max_tokens=80)
        data = extract_json(raw)

        ranked: list[int] = [
            i for i in data.get("ranked", [])
            if isinstance(i, int) and 0 <= i < len(sessions)
        ]
        # 빠진 인덱스는 뒤에 추가
        seen = set(ranked)
        ranked += [i for i in range(len(sessions)) if i not in seen]

        reranked = [sessions[i] for i in ranked]
        logger.info("리랭킹 완료: %s → %s", list(range(len(sessions))), ranked)
        return reranked

    except Exception as exc:
        logger.warning("리랭킹 실패 (%s) — 원래 순서 유지", exc)
        return sessions
