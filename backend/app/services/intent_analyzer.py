"""배치 세션화의 의도 분석 — 이벤트 그룹을 기존 세션에 이어붙일지, 새 세션을 만들지,
보류할지, 폐기할지 LLM으로 판단한다 (docs/target-architecture.md §1, §2).

프롬프트/스키마/파싱을 이 모듈에 중앙화한다(summarizer.py/clusterer.py 컨벤션 동일).
"""

import logging
import re
from dataclasses import dataclass

from ..ai.json_utils import extract_json
from ..ai.llm import chat_completion_with_meta

logger = logging.getLogger(__name__)

PROMPT_VERSION = "v1"

_VALID_ACTIONS = {"append", "create", "hold", "discard"}
_CANDIDATE_LABEL_RE = re.compile(r"^S(\d+)$")

_MAX_TITLE_CHARS = 50
_MAX_OVERVIEW_CHARS = 80

_SYSTEM_PROMPT = """\
당신은 사용자의 브라우저 방문 이벤트를 분석해 탐색 세션으로 묶는 AI입니다.
반드시 JSON 형식으로만 응답하고, 한국어로 작성하세요."""

_USER_TEMPLATE = """\
다음은 사용자가 최근 방문한 이벤트 목록입니다.

[이벤트]
{events_text}

[기존 세션 후보]
{candidates_text}

각 이벤트(또는 이벤트 묶음)를 다음 중 하나로 분류하세요:
- append: 기존 세션 후보 중 하나와 이어지는 방문이면 해당 세션(target)에 추가
- create: 새로운 탐색 주제이면 새 세션 생성(title, purpose 작성)
- hold: 이 정보만으로 판단하기 어려우면 보류(다음 배치에서 재판단)
- discard: 광고, 리다이렉트, 오류/빈 페이지 등 의미 없는 방문이면 폐기

판단 지침:
- 기존 세션과의 연관성이 확실하지 않으면 append보다 create를 선택하세요(기존 세션 오염 방지).
- 같은 주제/작업 흐름에 속하는 이벤트는 event_indices에 함께 묶으세요.
- 정말 판단하기 어려운 경우에만 hold를 사용하세요.

아래 JSON 스키마로만 응답하세요(예시):
{{
  "assignments": [
    {{
      "event_indices": [0, 1],
      "action": "append",
      "target": "S0",
      "title": "",
      "purpose": "",
      "relevance": 0.8
    }}
  ]
}}"""


@dataclass
class Assignment:
    event_indices: list[int]
    action: str
    target: str | None = None
    title: str | None = None
    purpose: str | None = None
    relevance: float = 0.0
    # 이 assignment를 만든 LLM 호출의 실제 사용 모델(감사용). LLM 예외로 인한
    # hold fallback에서는 None.
    model: str | None = None


def _format_event_line(index: int, event: dict) -> str:
    title = (event.get("title") or "")[:_MAX_TITLE_CHARS]
    domain = event.get("domain") or ""
    duration_min = round((event.get("active_duration_ms") or 0) / 60000, 1)
    visited_at = event.get("visited_at")
    time_str = visited_at.strftime("%H:%M") if visited_at else ""

    line = f"[{index}] {title} | {domain} | 체류 {duration_min}분 | {time_str}"
    search_query = event.get("search_query")
    if search_query:
        line += f" | 검색어: {search_query}"
    return line


def _format_candidate_line(index: int, candidate: dict) -> str:
    title = candidate.get("title") or ""
    overview = (candidate.get("overview") or "")[:_MAX_OVERVIEW_CHARS]
    keywords = ", ".join(candidate.get("keywords") or [])
    return f"[S{index}] {title} | {overview} | {keywords}"


def _build_prompt(group: list[dict], candidates: list[dict]) -> str:
    events_text = "\n".join(_format_event_line(i, e) for i, e in enumerate(group))
    candidates_text = (
        "\n".join(_format_candidate_line(i, c) for i, c in enumerate(candidates))
        if candidates
        else "(없음)"
    )
    return _USER_TEMPLATE.format(events_text=events_text, candidates_text=candidates_text)


def _parse_candidate_index(label: object) -> int | None:
    if not isinstance(label, str):
        return None
    match = _CANDIDATE_LABEL_RE.match(label.strip())
    if not match:
        return None
    return int(match.group(1))


def _clamp_relevance(value: object) -> float:
    try:
        relevance = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    return min(max(relevance, 0.0), 1.0)


async def analyze(group: list[dict], candidates: list[dict]) -> list[Assignment]:
    """이벤트 그룹에 대해 LLM 의도 분석을 수행하고 방어적으로 파싱한다.

    - 범위 밖 인덱스는 제거, 중복 인덱스는 먼저 등장한 assignment가 우선한다.
    - 미할당 이벤트는 hold로 fallback.
    - 알 수 없는 action은 hold로 대체.
    - target이 후보 목록 밖이면 create로 강등.
    - LLM 호출/파싱 실패는 그룹 전체를 hold 처리한다.
    """
    if not group:
        return []

    try:
        raw, model = await chat_completion_with_meta(
            _SYSTEM_PROMPT, _build_prompt(group, candidates), max_tokens=1000
        )
        data = extract_json(raw)
        if not isinstance(data, dict):
            raise ValueError(f"의도 분석 응답이 dict가 아닙니다: {type(data)}")
        assignments_raw = data.get("assignments", [])
        if not isinstance(assignments_raw, list):
            raise ValueError("assignments가 list가 아닙니다")
    except Exception as exc:
        logger.warning("의도 분석 실패 (%s) — 그룹 전체 hold 처리", exc)
        return [
            Assignment(event_indices=list(range(len(group))), action="hold", relevance=0.0)
        ]

    assigned: set[int] = set()
    result: list[Assignment] = []

    for item in assignments_raw:
        if not isinstance(item, dict):
            continue

        indices = [
            i
            for i in item.get("event_indices", [])
            if isinstance(i, int) and 0 <= i < len(group) and i not in assigned
        ]
        if not indices:
            continue
        assigned.update(indices)

        action = item.get("action")
        if action not in _VALID_ACTIONS:
            action = "hold"

        target_session_id: str | None = None
        if action == "append":
            idx = _parse_candidate_index(item.get("target"))
            if idx is not None and 0 <= idx < len(candidates):
                target_session_id = candidates[idx].get("session_id")
            else:
                action = "create"  # 후보 밖 target → create로 강등

        title = item.get("title")
        purpose = item.get("purpose")

        result.append(
            Assignment(
                event_indices=indices,
                action=action,
                target=target_session_id,
                title=str(title).strip() if title else None,
                purpose=str(purpose).strip() if purpose else None,
                relevance=_clamp_relevance(item.get("relevance")),
                model=model,
            )
        )

    missing = [i for i in range(len(group)) if i not in assigned]
    if missing:
        result.append(Assignment(event_indices=missing, action="hold", relevance=0.0, model=model))

    return result
