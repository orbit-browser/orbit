"""큰 서브클러스터를 '알아본 대상'으로 다시 나눈다 — 의도 분석 전 단계.

같은 범주의 다른 대상(두 도시 여행, 두 제품, 두 언어)은 임베딩이 가까워 서브클러스터 하나로 들어오고
(S1 검증셋 47개 중 44개), 의도 분석 LLM은 그 묶음을 상위 범주 세션 하나로 만든다. 그래서 이벤트가
많은 묶음에만 LLM에게 이벤트마다 대상을 묻고, 대상이 둘 이상이면 대상별 묶음으로 나눠 의도 분석에 넘긴다.

실패(호출 오류, 형식 오류)는 나누지 않는 쪽(지금 동작)으로 둔다. 판단이 어려우면 같은 대상으로 두라고
지시한다 — 한 주제를 쪼개는 과분할(origin #22)이 형제를 합치는 것보다 사용자에게 더 거슬린다.
"""

import logging

from ..ai.json_utils import extract_json
from ..ai.llm import chat_completion_intent
from .intent_analyzer import _format_event_line

logger = logging.getLogger(__name__)

# 이보다 작은 묶음은 묻지 않는다(호출 비용·지연). 형제 두 대상이 각각 여러 페이지일 때 효과가 있다.
MIN_EVENTS = 6

_SYSTEM_PROMPT = """\
당신은 사용자의 브라우저 방문 기록에서 사용자가 알아본 '대상'을 구분하는 AI입니다.
반드시 JSON 형식으로만 응답하세요(설명 문장 금지)."""

_USER_TEMPLATE = """\
다음은 사용자가 한 시간대에 방문한 페이지입니다.

[이벤트]
{events_text}

이 기록에 사용자의 목적(알아본 대상)이 몇 개 섞여 있는지 판단하고, 목적마다 이벤트 번호를 묶으세요.
- 여행은 목적지 도시·지역 하나가 목적입니다. 그곳의 교통·숙소·명소·음식 페이지는 모두 같은 목적입니다.
- 물건은 살 물건 하나가 목적입니다. 그 물건의 사양·가격·후기·액세서리는 같은 목적입니다.
- 공부·과제·준비는 그 일 하나가 목적입니다. 그 안의 하위 개념·단계는 같은 목적입니다.
- 서로 다른 목적지, 서로 다른 제품, 서로 다른 제도·질병·언어·인물을 각각 알아봤다면 다른 목적입니다.
  같은 범주(예: 둘 다 여행지, 둘 다 세금)라는 이유로 하나로 합치지 마세요.
- 판단하기 어려우면 같은 목적으로 두세요. 포털·피드 같은 페이지는 바로 앞 이벤트의 목적에 넣으세요.

묶음이 둘 이상이면 relation을 쓰세요. 기준은 "사용자가 묶음마다 서로 다른 결정이나 작업을 하고 있는가"입니다.
- "independent": 묶음마다 따로 결정·작업한다. 두 여행지를 각각 준비하거나, 두 제품을 각각 알아보거나,
  서로 다른 질병·제도·인물·생물을 각각 찾아본 경우다.
- "facets": 결정·작업은 하나이고 그것을 위해 여러 항목을 봤다. 이사 한 번의 업체·청소·전입신고, 시험 하나를
  위한 여러 단원·항목, 행사 하나의 여러 준비, 한 여행지의 명소와 음식처럼 같은 종류의 항목이라도 하나의 일에
  속하면 facets다.
- "unsure": 어느 쪽인지 확실하지 않다.
independent는 확실할 때만 쓰세요.
목적 이름(subject)은 목적지·제품·과목처럼 목적 자체의 이름으로 쓰고, 페이지 이름을 쓰지 마세요.
이벤트가 하나뿐인 묶음은 만들지 말고, 그 이벤트가 속한 목적의 묶음에 넣으세요.
모든 이벤트 번호가 정확히 한 묶음에 들어가야 합니다. relation을 먼저 정하고 groups를 쓰세요.
아래 JSON으로만 응답하세요(값은 형식 예시이고, 목적이 하나면 묶음 하나).
{{"relation": "<independent 또는 facets 또는 unsure>", "groups": [{{"subject": "목적 이름", "events": [0, 1, 4]}}, {{"subject": "목적 이름", "events": [2, 3, 5]}}]}}"""


def _parse_labels(raw: str, n: int) -> list[int] | None:
    """이벤트별 묶음 번호. 빠진 이벤트·겹친 이벤트·형식 오류가 있으면 None(나누지 않는다)."""
    data = extract_json(raw)
    groups = data.get("groups") if isinstance(data, dict) else None
    if not isinstance(groups, list) or not groups:
        return None
    if len(groups) > 1 and data.get("relation") != "independent":
        # 세부 항목이거나 관계를 밝히지 않았으면 나누지 않는다(한 주제 쪼개기 방지).
        return [0] * n
    labels: list[int | None] = [None] * n
    for number, group in enumerate(groups):
        indices = group.get("events") if isinstance(group, dict) else None
        if not isinstance(indices, list):
            return None
        for index in indices:
            if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < n:
                return None
            if labels[index] is not None:
                return None
            labels[index] = number
    if any(label is None for label in labels):
        return None
    return labels  # type: ignore[return-value]


def _groups(labels: list[int]) -> list[list[int]]:
    """대상별 인덱스 묶음(첫 등장 순서). 이벤트 하나짜리 대상은 바로 앞(없으면 뒤) 이벤트의 묶음에 붙인다 —
    한 페이지만으로 세션을 따로 만들 근거가 약하다."""
    by_label: dict[int, list[int]] = {}
    for index, label in enumerate(labels):
        by_label.setdefault(label, []).append(index)
    if len(by_label) <= 1:
        return [list(range(len(labels)))]
    owner = {i: label for label, idx in by_label.items() if len(idx) >= 2 for i in idx}
    if len({*owner.values()}) <= 1:
        return [list(range(len(labels)))]
    groups = {label: list(idx) for label, idx in by_label.items() if len(idx) >= 2}
    for label, idx in by_label.items():
        if len(idx) >= 2:
            continue
        index = idx[0]
        preceding = [owner[i] for i in range(index - 1, -1, -1) if i in owner]
        target = preceding[0] if preceding else next(owner[i] for i in sorted(owner) if i > index)
        groups[target].append(index)
    return sorted((sorted(g) for g in groups.values()), key=lambda g: g[0])


async def split_by_subject(events: list[dict]) -> list[list[int]]:
    """이벤트 인덱스를 대상별 묶음으로 돌려준다. 작은 묶음·실패·대상 하나면 [전체] 그대로."""
    whole = [list(range(len(events)))]
    if len(events) < MIN_EVENTS:
        return whole
    prompt = _USER_TEMPLATE.format(
        events_text="\n".join(_format_event_line(i, e) for i, e in enumerate(events))
    )
    try:
        raw, model = await chat_completion_intent(_SYSTEM_PROMPT, prompt, temperature=0.0, max_tokens=400)
    except Exception as exc:
        logger.warning("Subject split call failed (%s); keeping the subcluster whole", type(exc).__name__)
        return whole
    try:
        labels = _parse_labels(raw, len(events))
    except Exception:
        labels = None
    if labels is None:
        logger.warning("Subject split response malformed (model=%s); keeping the subcluster whole", model)
        return whole
    groups = _groups(labels)
    if len(groups) > 1:
        logger.info("Subject split: %d events into %s (model=%s)", len(events), [len(g) for g in groups], model)
    return groups
