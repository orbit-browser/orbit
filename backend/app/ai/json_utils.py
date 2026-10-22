import json
import re

_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)
_JSON_OBJ_RE = re.compile(r"\{[\s\S]*\}", re.DOTALL)


def extract_json(raw: str) -> dict:
    """LLM 응답에서 JSON 객체를 추출한다.

    ```json ... ``` 코드펜스로 감싸진 경우, 앞뒤에 잡담이 섞인 경우,
    펜스 없이 순수 JSON만 온 경우를 모두 처리한다.
    """
    raw = raw.strip()

    match = _FENCE_RE.search(raw)
    if match:
        raw = match.group(1).strip()
    else:
        match = _JSON_OBJ_RE.search(raw)
        if match:
            raw = match.group().strip()

    # strict=False: 문자열 안의 날것 줄바꿈·탭을 허용한다. K-EXAONE이 reason 등에 개행을 그대로 넣어
    # 의도 분석이 매번 실패(그룹 hold)하고 해당 주제의 세션이 만들어지지 않았다(2026-10-19).
    return json.loads(raw, strict=False)
