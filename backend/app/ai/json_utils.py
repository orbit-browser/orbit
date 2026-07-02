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

    return json.loads(raw)
