import logging

import httpx
from fastapi import APIRouter, HTTPException

from ..schemas.assistant import AssistantRouteRequest, AssistantRouteResponse
from ..services.assistant_router import route_assistant

router = APIRouter(prefix="/assistant", tags=["assistant"])
logger = logging.getLogger(__name__)


@router.post("/route", response_model=AssistantRouteResponse)
async def resolve_assistant_route(body: AssistantRouteRequest) -> AssistantRouteResponse:
    try:
        return await route_assistant(body.query, body.session_id)
    except httpx.TimeoutException:
        logger.warning("Ask 의도 임베딩 서비스 timeout")
        raise HTTPException(status_code=504, detail="Embedding service timed out")
    except httpx.HTTPStatusError as exc:
        logger.warning("Ask 의도 임베딩 upstream 오류 (status=%s)", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Embedding service returned an error")
    except httpx.RequestError:
        logger.warning("Ask 의도 임베딩 서비스 연결 실패")
        raise HTTPException(status_code=503, detail="Embedding service unavailable")
    except (KeyError, IndexError, TypeError, ValueError):
        logger.exception("Ask 의도 임베딩 응답 형식 오류")
        raise HTTPException(status_code=502, detail="Embedding service returned an invalid response")
