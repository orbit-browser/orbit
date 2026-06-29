import json
import logging
import re

from .llm import chat_completion_light
from ..schemas.session import TabItemRequest

logger = logging.getLogger(__name__)

_MIN_TABS = 4       # 이 미만이면 클러스터링 없이 단일 그룹 반환
_MAX_TABS = 20      # 프롬프트에 포함할 탭 최대 수
_MAX_TITLE = 50     # 탭 제목 최대 길이 (토큰 절약)

_SYSTEM = """\
당신은 브라우저 탭을 주제별로 묶는 AI입니다.
탭 제목과 URL을 보고 의미적으로 관련 있는 탭끼리 그룹을 만드세요.
반드시 JSON만 응답하고, 주제명은 한국어로 20자 이내로 작성하세요."""

_USER_TEMPLATE = """\
다음 탭 목록을 주제별로 묶어주세요:

{tab_list}

같은 주제나 작업 흐름에 속하는 탭끼리 묶고, 아래 JSON 형식으로만 반환하세요:
{{
  "clusters": [
    {{"topic": "주제명", "indices": [0, 2, 5]}},
    {{"topic": "주제명", "indices": [1, 3, 4]}}
  ]
}}"""

_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def _extract_json(raw: str) -> dict:
    raw = raw.strip()
    match = _FENCE_RE.search(raw)
    if match:
        raw = match.group(1).strip()
    return json.loads(raw)


def _build_prompt(tabs: list[TabItemRequest]) -> str:
    lines = [
        f"[{i}] {(tab.title or '')[:_MAX_TITLE]} — {tab.url}"
        for i, tab in enumerate(tabs[:_MAX_TABS])
    ]
    return _USER_TEMPLATE.format(tab_list="\n".join(lines))


async def cluster_tabs(tabs: list[TabItemRequest]) -> list[list[TabItemRequest]]:
    """탭 목록을 주제별로 그루핑해 반환. 실패 시 단일 그룹 fallback."""
    if len(tabs) < _MIN_TABS:
        return [tabs]

    try:
        raw = await chat_completion_light(_SYSTEM, _build_prompt(tabs), max_tokens=400)
        data = _extract_json(raw)
        if not isinstance(data, dict):
            raise ValueError(f"클러스터링 응답이 dict가 아닙니다: {type(data)}")
        clusters = data.get("clusters", [])

        seen: set[int] = set()
        result: list[list[TabItemRequest]] = []

        for c in clusters:
            indices = [
                i for i in c.get("indices", [])
                if isinstance(i, int) and 0 <= i < len(tabs) and i not in seen
            ]
            seen.update(indices)
            if indices:
                result.append([tabs[i] for i in indices])

        # LLM이 빠뜨린 탭은 마지막 그룹에 추가
        missed = [tabs[i] for i in range(min(len(tabs), _MAX_TABS)) if i not in seen]
        if missed:
            if result:
                result[-1].extend(missed)
            else:
                result.append(missed)

        # _MAX_TABS 초과 탭은 항상 마지막 그룹에 추가
        overflow = tabs[_MAX_TABS:]
        if overflow:
            if result:
                result[-1].extend(overflow)
            else:
                result.append(overflow)

        logger.info("클러스터링 완료: 탭 %d개 → 세션 %d개", len(tabs), len(result))
        return result if result else [tabs]

    except Exception as exc:
        logger.warning("탭 클러스터링 실패 (%s) — 단일 세션 fallback", exc)
        return [tabs]
