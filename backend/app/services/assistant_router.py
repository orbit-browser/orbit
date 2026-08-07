import asyncio
import re
import unicodedata

from ..ai.embedding import embed, embed_many
from ..config import settings
from ..schemas.assistant import AssistantIntent, AssistantRouteResponse
from .tab_action_resolver import cosine_similarity


_INTENT_PASSAGES: tuple[tuple[AssistantIntent, str], ...] = (
    (
        "navigate_tab",
        "현재 열려 있는 브라우저 탭이나 웹페이지 화면으로 이동, 전환하거나 아까 보던 곳으로 돌아가 달라는 요청",
    ),
    (
        "navigate_tab",
        "보고 있던 동영상, 작성하던 문서, 확인하던 메일이나 코드 탭을 다시 열어 이어서 보려는 브라우저 조작",
    ),
    (
        "find_sessions",
        "저장된 탐색 세션이나 브라우징 기록 중 관련 주제의 세션 자체를 찾아 목록으로 보여 달라는 요청",
    ),
    (
        "find_sessions",
        "어느 세션에서 조사했는지, 관련 세션이 어디 있는지 찾아 달라는 요청",
    ),
    (
        "search_session",
        "특정 세션 안의 방문 페이지와 기록에서 내용, 사실, 결론이나 정보를 찾아 답해 달라는 요청",
    ),
    (
        "search_session",
        "이 세션이나 해당 세션에서 무엇을 봤고 어떤 내용을 조사했는지 요약하거나 질문하는 요청",
    ),
    (
        "search_memory",
        "전체 과거 브라우징과 탐색 기록에서 봤던 정보, 사실, 장소, 제품이나 내용을 찾아 답해 달라는 요청",
    ),
    (
        "search_memory",
        "전에 공부하거나 조사한 내용을 요약, 분석, 설명, 비교하고 결론을 알려 달라는 질문",
    ),
)

_NAVIGATION_RULES = (
    re.compile(r"(?:탭|화면|페이지|영상|문서|메일|코드).*(?:이동|전환|돌아가|돌아와|가\s*줘|가자|열어\s*줘|띄워\s*줘)"),
    re.compile(r"(?:이동|전환|돌아가|돌아와|가\s*줘|가자).*(?:탭|화면|페이지|영상|문서|메일|코드)"),
    re.compile(r"\b(?:switch|go back|return to|take me to)\b", re.IGNORECASE),
)
_NAVIGATION_META_RULES = (
    re.compile(
        r"(?:탭|페이지|화면).*(?:이동|전환).*(?:기능|방법|원리|설명|구현|어떻게|왜|안\s*(?:돼|되)|실패|문제)"
    ),
    re.compile(r"(?:이동|전환).*(?:기능|방법|원리|설명|구현|안\s*(?:돼|되)|실패|문제)"),
)
_FIND_SESSION_RULES = (
    re.compile(r"(?:세션|탐색\s*기록|브라우징\s*기록).*(?:찾|보여|목록|어디)"),
    re.compile(r"(?:찾|보여).*(?:세션|탐색\s*기록|브라우징\s*기록)"),
    re.compile(r"(?:기록|묶음)(?:을|를|이|가)?\s*(?:찾|보여|목록|어디|위치)"),
)
_SEARCH_SESSION_RULES = (
    re.compile(r"(?:이|그|해당|선택한)\s*세션"),
    re.compile(r"세션\s*(?:안|내부)?에서"),
    re.compile(r"세션\s*(?:안|내부)?(?:의|에 있는)"),
)
_SEARCH_MEMORY_RULES = (
    re.compile(r"(?:기록|브라우징|탐색).*(?:바탕으로|근거로)"),
)
_CONTENT_QUESTION_RULES = (
    re.compile(r"(?:내용|정보|결론|장점|단점|차이|뜻|번호|가격|이름).*(?:뭐|무엇|무슨|알려|요약|정리|설명|비교|찾)"),
    re.compile(r"(?:요약|정리|설명|비교)(?:해|해\s*줘|해\s*주세요|해줘|해주세요)"),
)


def rule_intent(query: str, session_id: str | None = None) -> AssistantIntent | None:
    normalized = " ".join(unicodedata.normalize("NFKC", query).split())
    if any(pattern.search(normalized) for pattern in _NAVIGATION_META_RULES):
        return "search_session" if session_id else "search_memory"
    if any(pattern.search(normalized) for pattern in _NAVIGATION_RULES):
        return "navigate_tab"
    if re.search(r"어느\s*세션", normalized):
        return "find_sessions"
    if any(pattern.search(normalized) for pattern in _SEARCH_SESSION_RULES):
        return "search_session"
    if any(pattern.search(normalized) for pattern in _SEARCH_MEMORY_RULES):
        return "search_memory"
    if any(pattern.search(normalized) for pattern in _FIND_SESSION_RULES):
        return "find_sessions"
    if session_id:
        return "search_session"
    if any(pattern.search(normalized) for pattern in _CONTENT_QUESTION_RULES):
        return "search_memory"
    return None


def _class_scores(query_vector: list[float], vectors: list[list[float]]) -> dict[AssistantIntent, float]:
    if len(vectors) != len(_INTENT_PASSAGES):
        raise ValueError("embedding response count does not match intent prototypes")
    scores: dict[AssistantIntent, float] = {}
    for (intent, _passage), vector in zip(_INTENT_PASSAGES, vectors):
        scores[intent] = max(scores.get(intent, -1.0), cosine_similarity(query_vector, vector))
    return scores


def route_from_vectors(
    query_vector: list[float],
    intent_vectors: list[list[float]],
) -> AssistantRouteResponse:
    scores = _class_scores(query_vector, intent_vectors)
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    top_intent, top_score = ranked[0]
    second_score = ranked[1][1]
    margin = top_score - second_score

    if top_intent == "navigate_tab":
        if (
            top_score >= settings.assistant_route_navigation_floor
            and margin >= settings.assistant_route_navigation_margin
        ):
            return AssistantRouteResponse(
                intent=top_intent,
                confidence=round(top_score, 6),
                margin=round(margin, 6),
                reason="semantic",
            )
        ranked = [item for item in ranked if item[0] != "navigate_tab"]
        top_intent, top_score = ranked[0]
        second_score = ranked[1][1]
        margin = top_score - second_score

    if margin < settings.assistant_route_retrieval_margin:
        return AssistantRouteResponse(
            intent="search_memory",
            confidence=round(top_score, 6),
            margin=round(margin, 6),
            reason="fallback",
        )
    return AssistantRouteResponse(
        intent=top_intent,
        confidence=round(top_score, 6),
        margin=round(margin, 6),
        reason="semantic",
    )


async def route_assistant(query: str, session_id: str | None = None) -> AssistantRouteResponse:
    ruled = rule_intent(query, session_id)
    if ruled:
        return AssistantRouteResponse(intent=ruled, confidence=1.0, margin=1.0, reason="rule")

    query_vector, intent_vectors = await asyncio.gather(
        embed(query),
        embed_many(
            [passage for _intent, passage in _INTENT_PASSAGES],
            model=settings.embedding_passage_model,
        ),
    )
    return route_from_vectors(query_vector, intent_vectors)
