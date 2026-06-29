import json
import logging
import re

from ..ai.llm import chat_completion
from ..schemas.session import SessionSummary, TabItemRequest

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
당신은 브라우저 탭 묶음을 분석해 사용자의 탐색 목적과 맥락을 파악하는 AI입니다.
반드시 JSON 형식으로만 응답하고, 한국어로 작성하세요."""

_USER_PROMPT = """\
다음은 사용자가 열어둔 탭 목록입니다.

{tabs_text}

아래 JSON 스키마로 분석 결과를 반환하세요:
{{
  "title": "세션 제목 (20자 이내)",
  "overview": "한 줄 개요",
  "purpose": "탐색 목적",
  "highlights": ["핵심 정보1", "핵심 정보2"],
  "todos": ["미완료 작업"],
  "next_actions": ["다음 행동"]
}}"""

_MAX_CHARS_PER_TAB = 2000
_MAX_TABS = 10


def _build_tabs_text(tabs: list[TabItemRequest]) -> str:
    parts = []
    for i, tab in enumerate(tabs[:_MAX_TABS], 1):
        text = (tab.text_content or "").strip()[:_MAX_CHARS_PER_TAB]
        parts.append(f"[{i}] {tab.title}\nURL: {tab.url}\n{text}")
    return "\n\n---\n\n".join(parts)


def _rule_based_title(tabs: list[TabItemRequest]) -> str:
    if not tabs:
        return "새 세션"
    if len(tabs) == 1:
        return tabs[0].title[:20]
    return f"{tabs[0].title[:15]} 외 {len(tabs) - 1}개"


_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def _extract_json(raw: str) -> dict:
    """JSON 블록 추출 — ```json ... ``` 래핑 및 앞뒤 텍스트 대응."""
    raw = raw.strip()
    match = _FENCE_RE.search(raw)
    if match:
        raw = match.group(1).strip()
    return json.loads(raw)


async def generate_summary(
    tabs: list[TabItemRequest],
) -> tuple[str, SessionSummary]:
    """탭 목록 → (title, SessionSummary). LLM 실패 시 규칙 기반 fallback."""
    prompt = _USER_PROMPT.format(tabs_text=_build_tabs_text(tabs))

    try:
        raw = await chat_completion(_SYSTEM_PROMPT, prompt, max_tokens=600)
        data = _extract_json(raw)

        title = str(data.get("title") or "").strip()[:20] or _rule_based_title(tabs)
        summary = SessionSummary(
            overview=str(data.get("overview") or ""),
            purpose=str(data.get("purpose") or ""),
            highlights=[str(h) for h in (data.get("highlights") or [])],
            todos=[str(t) for t in (data.get("todos") or [])],
            next_actions=[str(a) for a in (data.get("next_actions") or [])],
        )
        return title, summary

    except Exception as exc:
        logger.warning("LLM 요약 실패 (%s) — 규칙 기반 fallback 적용", exc)
        return _rule_based_title(tabs), SessionSummary(
            overview=f"{len(tabs)}개 탭 세션",
            highlights=[t.title for t in tabs[:3]],
        )
