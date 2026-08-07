import asyncio
import math
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

from ..ai.embedding import embed, embed_many
from ..config import settings
from ..schemas.tab_action import (
    OpenTabCandidate,
    TabActionCandidateMatch,
    TabActionResolveResponse,
)


_INTENT_PASSAGES: tuple[tuple[str, str], ...] = (
    (
        "navigate",
        "현재 열려 있는 브라우저 탭이나 웹페이지로 이동하고 전환하거나 돌아가 달라는 브라우저 조작 요청",
    ),
    (
        "navigate",
        "아까 보던 영상, 작성하던 문서, 확인하던 메일, 작업하던 코드 화면을 다시 열고 이어서 보려는 요청",
    ),
    (
        "ask",
        "과거 탐색 기록이나 현재 페이지와 코드의 내용을 찾아 요약, 분석, 문제점 확인, 설명, 비교하거나 질문에 답해 달라는 요청",
    ),
    (
        "search",
        "웹에서 새로운 정보, 사이트, 문서, 동영상이나 검색 결과를 찾아 달라는 요청",
    ),
    (
        "general",
        "일반적인 지식이나 개념에 대한 설명과 답변을 요청",
    ),
)

_SITE_DESCRIPTIONS: tuple[tuple[str, str], ...] = (
    ("youtube.com", "유튜브에서 동영상을 검색하고 시청하는 사이트"),
    ("github.com", "깃허브에서 소스 코드와 Git 저장소, 이슈, pull request를 확인하는 개발 사이트"),
    ("notion.so", "노션에서 노트, 문서, 제품 로드맵과 업무 내용을 정리하는 협업 사이트"),
    ("mail.google.com", "Gmail 이메일과 받은편지함을 확인하는 사이트"),
    ("gmail.com", "Gmail 이메일과 받은편지함을 확인하는 사이트"),
    ("react.dev", "React 리액트 공식 개발 문서"),
    ("figma.com", "피그마에서 UI 디자인 화면과 프로토타입을 편집하는 협업 사이트"),
    ("slack.com", "슬랙에서 팀 채팅과 업무 메시지를 확인하는 협업 사이트"),
    ("chatgpt.com", "챗지피티 ChatGPT와 AI 대화를 하는 사이트"),
    ("openai.com", "OpenAI와 ChatGPT 관련 사이트"),
    ("docs.google.com", "Google 문서와 스프레드시트, 프레젠테이션을 편집하는 사이트"),
    ("drive.google.com", "Google Drive 파일을 보관하고 찾는 사이트"),
    ("maps.google.com", "Google 지도에서 장소와 길을 찾는 사이트"),
    ("map.naver.com", "네이버 지도에서 장소와 길을 찾는 사이트"),
    ("news.naver.com", "뉴스 기사를 읽는 사이트"),
)

_TEXT_ALIASES: tuple[tuple[str, str], ...] = (
    ("orbit", "오빗"),
)


@dataclass(frozen=True)
class RankedCandidate:
    candidate: OpenTabCandidate
    score: float


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        raise ValueError("embedding dimensions do not match")
    dot = sum(a * b for a, b in zip(left, right))
    norm = math.sqrt(sum(value * value for value in left)) * math.sqrt(
        sum(value * value for value in right)
    )
    if not norm or not math.isfinite(norm):
        raise ValueError("embedding norm is invalid")
    score = dot / norm
    if not math.isfinite(score):
        raise ValueError("embedding score is invalid")
    return score


def _safe_url_parts(raw_url: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(raw_url)
    except ValueError:
        return "", ""
    host = (parsed.hostname or parsed.netloc or "").lower().removeprefix("www.")
    path = unquote(parsed.path or "").strip("/")
    return host[:253], path[:500]


def _site_description(host: str) -> str:
    for suffix, description in _SITE_DESCRIPTIONS:
        if host == suffix or host.endswith(f".{suffix}"):
            return description
    return ""


def build_candidate_passage(candidate: OpenTabCandidate) -> str:
    host, path = _safe_url_parts(candidate.url)
    fields = ["현재 열려 있는 브라우저 탭", f"제목: {candidate.title or '(제목 없음)'}"]
    if host:
        fields.append(f"호스트: {host}")
    if path:
        fields.append(f"경로: {path}")
    description = _site_description(host)
    if description:
        fields.append(f"용도: {description}")
    searchable = f"{candidate.title} {host} {path}".lower()
    aliases = [alias for token, alias in _TEXT_ALIASES if token in searchable]
    if aliases:
        fields.append(f"관련 이름: {' '.join(aliases)}")
    return "\n".join(fields)


def _class_scores(query_vector: list[float], intent_vectors: list[list[float]]) -> dict[str, float]:
    scores: dict[str, float] = {}
    for (kind, _text), vector in zip(_INTENT_PASSAGES, intent_vectors):
        scores[kind] = max(scores.get(kind, -1.0), cosine_similarity(query_vector, vector))
    return scores


def _rank_candidates(
    query_vector: list[float],
    candidates: list[OpenTabCandidate],
    candidate_vectors: list[list[float]],
) -> list[RankedCandidate]:
    ranked = [
        RankedCandidate(candidate=candidate, score=cosine_similarity(query_vector, vector))
        for candidate, vector in zip(candidates, candidate_vectors)
    ]
    return sorted(ranked, key=lambda item: (item.score, item.candidate.active), reverse=True)


def resolve_from_vectors(
    query_vector: list[float],
    candidates: list[OpenTabCandidate],
    passage_vectors: list[list[float]],
) -> TabActionResolveResponse:
    intent_count = len(_INTENT_PASSAGES)
    if len(passage_vectors) != intent_count + len(candidates):
        raise ValueError("embedding response count does not match request")

    class_scores = _class_scores(query_vector, passage_vectors[:intent_count])
    navigate_score = class_scores["navigate"]
    other_score = max(score for kind, score in class_scores.items() if kind != "navigate")
    intent_margin = navigate_score - other_score
    if (
        navigate_score < settings.tab_action_intent_score_floor
        or intent_margin < settings.tab_action_intent_margin
    ):
        return TabActionResolveResponse(action="ask", reason="non_navigation")

    ranked = _rank_candidates(query_vector, candidates, passage_vectors[intent_count:])
    if not ranked:
        return TabActionResolveResponse(action="ask", reason="low_confidence")
    top = ranked[0]
    candidate_margin = top.score - ranked[1].score if len(ranked) > 1 else top.score
    if (
        top.score < settings.tab_action_match_score_floor
        or candidate_margin < settings.tab_action_match_margin
    ):
        candidate_matches = []
        if top.score >= settings.tab_action_match_score_floor:
            close_matches = [
                item
                for item in ranked[:3]
                if item.score >= settings.tab_action_match_score_floor
                and top.score - item.score <= 0.12
            ]
            if len(close_matches) >= 2:
                candidate_matches = [
                    TabActionCandidateMatch(
                        tab_id=item.candidate.id,
                        score=round(item.score, 6),
                    )
                    for item in close_matches
                ]
        return TabActionResolveResponse(
            action="ask",
            reason="low_confidence",
            score=round(top.score, 6),
            margin=round(candidate_margin, 6),
            candidates=candidate_matches,
        )

    return TabActionResolveResponse(
        action="navigate_tab",
        reason="matched",
        tab_id=top.candidate.id,
        score=round(top.score, 6),
        margin=round(candidate_margin, 6),
    )


async def resolve_tab_action(
    query: str,
    candidates: list[OpenTabCandidate],
) -> TabActionResolveResponse:
    passages = [text for _kind, text in _INTENT_PASSAGES] + [
        build_candidate_passage(candidate) for candidate in candidates
    ]
    query_vector, passage_vectors = await asyncio.gather(
        embed(query),
        embed_many(passages, model=settings.embedding_passage_model),
    )
    return resolve_from_vectors(query_vector, candidates, passage_vectors)
