import logging

import httpx
from fastapi import APIRouter, HTTPException

from ..schemas.tab_action import TabActionResolveRequest, TabActionResolveResponse
from ..services.tab_action_resolver import resolve_tab_action

router = APIRouter(prefix="/tab-actions", tags=["tab-actions"])
logger = logging.getLogger(__name__)


@router.post("/resolve", response_model=TabActionResolveResponse)
async def resolve_open_tab_action(body: TabActionResolveRequest) -> TabActionResolveResponse:
    try:
        return await resolve_tab_action(body.query, body.candidates)
    except httpx.TimeoutException:
        logger.warning("탭 이동 임베딩 서비스 timeout")
        raise HTTPException(status_code=504, detail="Embedding service timed out")
    except httpx.HTTPStatusError as exc:
        logger.warning("탭 이동 임베딩 upstream 오류 (status=%s)", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Embedding service returned an error")
    except httpx.RequestError:
        logger.warning("탭 이동 임베딩 서비스 연결 실패")
        raise HTTPException(status_code=503, detail="Embedding service unavailable")
    except (KeyError, IndexError, TypeError, ValueError):
        logger.exception("탭 이동 임베딩 응답 형식 오류")
        raise HTTPException(status_code=502, detail="Embedding service returned an invalid response")
