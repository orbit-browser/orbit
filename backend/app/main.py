"""Orbit backend (스켈레톤).

후속 단계에서 세션 분석/요약/검색 및 Agent Action 엔드포인트를 구현합니다.
현재는 헬스체크만 제공합니다.
"""

from fastapi import FastAPI

app = FastAPI(title="Orbit API", version="0.0.1")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
