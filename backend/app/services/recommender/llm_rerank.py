"""추천 후보 LLM 리랭킹 — 상위 후보 중 "지금 다시 이어서 탐색할 가치"로 3개를 고른다.

1차 점수(`scoring.py`)가 저렴하게 10~20개로 줄인 뒤 여기로 넘어온다.
LLM 호출은 추천 경로에서 **여기 한 번뿐**이다.

응답을 신뢰하지 않는다 — 인덱스 범위·중복·개수를 검증하고, 어긋나면 규칙 기반으로
폴백한다(AGENTS.md §11). 폴백해도 추천 자체는 나가야 한다.
"""

import logging
from dataclasses import dataclass

from ...ai.json_utils import extract_json
from ...ai.llm import chat_completion
from .scoring import RecommendationKind, ScoredSession, classify_kind

logger = logging.getLogger(__name__)

_SYSTEM = """\
당신은 사용자의 개인 탐색 기록을 큐레이션하는 전문가입니다.
지금 사용자가 다시 이어서 탐색할 가치가 높은 세션 3개를 고르세요.

각 세션에는 성격을 하나씩 부여합니다.
- continue: 최근 중단되어 바로 이어가기 좋은 세션
- related: 사용자가 지금 보고 있거나 검색 중인 내용과 연관된 과거 세션
- rediscover: 반복해서 탐색했거나 오래됐지만 다시 볼 가치가 높은 세션

가능하면 세 가지 성격을 서로 다르게 섞으세요.
reason은 왜 지금 이 세션인지를 한 문장(40자 이내)으로, 근거를 담아 한국어로 씁니다.
반드시 JSON만 반환하세요."""

_USER_TEMPLATE = """\
{context_block}
후보 세션:
{lines}

지금 이어서 탐색할 가치가 높은 순으로 3개를 고르세요.
예시: {{"picks": [{{"index": 2, "kind": "continue", "reason": "숙소 비교 도중 탐색이 중단됨"}}]}}"""

_MAX_REASON_LEN = 60


@dataclass(frozen=True)
class RecommendationContext:
    """지금 사용자가 무엇을 보고 있는지 — 없으면 비워 둔다."""

    current_title: str | None = None
    current_url: str | None = None
    query: str | None = None

    def to_prompt_block(self) -> str:
        parts = []
        if self.current_title or self.current_url:
            label = self.current_title or self.current_url
            parts.append(f"현재 보고 있는 페이지: {label}")
        if self.query:
            parts.append(f"현재 검색어: {self.query}")
        if not parts:
            return "현재 컨텍스트: (없음 — 새 탭을 막 열었습니다)\n"
        return "\n".join(parts) + "\n"


@dataclass(frozen=True)
class Pick:
    scored: ScoredSession
    kind: RecommendationKind
    reason: str


def _fallback_reason(scored: ScoredSession, kind: RecommendationKind) -> str:
    """LLM 이유를 못 받았을 때 신호에서 직접 문장을 만든다."""
    signals = scored.signals
    if kind is RecommendationKind.CONTINUE and signals.open_task_count:
        return f"남은 할 일 {signals.open_task_count}개가 아직 정리되지 않음"
    if kind is RecommendationKind.REDISCOVER and signals.distinct_visit_days > 1:
        return f"{signals.distinct_visit_days}일에 걸쳐 반복해서 탐색한 주제"
    if kind is RecommendationKind.RELATED:
        return "지금 보고 있는 내용과 연관된 과거 탐색"
    return "탐색이 중간에 멈춘 지점"


def _rule_based(candidates: list[ScoredSession], count: int) -> list[Pick]:
    """LLM 없이 규칙만으로 고른다 — 폴백 경로."""
    from .scoring import diversify

    kinds = {item.session_id: classify_kind(item) for item in candidates}
    picked = diversify(candidates, kinds, count=count)
    return [
        Pick(scored=item, kind=kinds[item.session_id], reason=_fallback_reason(item, kinds[item.session_id]))
        for item in picked
    ]


def _parse_picks(
    raw: str, candidates: list[ScoredSession], count: int
) -> list[Pick] | None:
    """LLM 응답을 검증한다. 하나라도 어긋나면 None(→ 폴백)."""
    try:
        data = extract_json(raw)
    except Exception:
        # JSON이 아예 아닌 응답("죄송합니다…" 같은 문장)도 여기로 온다.
        return None
    if not isinstance(data, dict):
        return None
    entries = data.get("picks")
    if not isinstance(entries, list) or not entries:
        return None

    picks: list[Pick] = []
    seen: set[int] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        index = entry.get("index")
        if not isinstance(index, int) or not (0 <= index < len(candidates)):
            continue
        if index in seen:
            continue
        seen.add(index)

        scored = candidates[index]
        try:
            kind = RecommendationKind(str(entry.get("kind", "")).strip().lower())
        except ValueError:
            kind = classify_kind(scored)

        reason = str(entry.get("reason") or "").strip()[:_MAX_REASON_LEN]
        picks.append(Pick(scored=scored, kind=kind, reason=reason or _fallback_reason(scored, kind)))
        if len(picks) == count:
            break

    return picks or None


def _candidate_lines(candidates: list[ScoredSession]) -> str:
    lines = []
    for i, item in enumerate(candidates):
        s = item.signals
        overview = (s.overview or "")[:80]
        bits = [f"[{i}] {s.title}"]
        if overview:
            bits.append(overview)
        meta = []
        if s.open_task_count:
            meta.append(f"남은 할 일 {s.open_task_count}개")
        if s.distinct_visit_days > 1:
            meta.append(f"{s.distinct_visit_days}일에 걸쳐 방문")
        if s.is_active:
            meta.append("진행 중")
        if meta:
            bits.append(" · ".join(meta))
        lines.append(" | ".join(bits))
    return "\n".join(lines)


async def rerank_recommendations(
    candidates: list[ScoredSession],
    context: RecommendationContext,
    count: int = 3,
) -> list[Pick]:
    """후보에서 최종 N개를 고르고 추천 이유를 붙인다.

    LLM 실패·형식 오류·빈 응답은 모두 규칙 기반 폴백으로 흡수한다 —
    추천이 안 나오느니 덜 정교한 추천이 낫다. 폴백 사실은 로그로 남긴다.
    """
    if not candidates:
        return []
    if len(candidates) <= count:
        return _rule_based(candidates, count)

    user_msg = _USER_TEMPLATE.format(
        context_block=context.to_prompt_block(),
        lines=_candidate_lines(candidates),
    )

    try:
        raw = await chat_completion(_SYSTEM, user_msg, temperature=0.2, max_tokens=400)
    except Exception as exc:
        logger.warning("[recommend] LLM 리랭킹 실패(%s) — 규칙 기반으로 대체", exc)
        return _rule_based(candidates, count)

    picks = _parse_picks(raw, candidates, count)
    if picks is None:
        logger.warning("[recommend] LLM 응답 형식 오류 — 규칙 기반으로 대체")
        return _rule_based(candidates, count)

    # LLM이 요청보다 적게 골랐으면 점수순으로 채운다.
    if len(picks) < count:
        chosen = {pick.scored.session_id for pick in picks}
        for item in candidates:
            if item.session_id in chosen:
                continue
            kind = classify_kind(item)
            picks.append(Pick(scored=item, kind=kind, reason=_fallback_reason(item, kind)))
            if len(picks) == count:
                break
    return picks
