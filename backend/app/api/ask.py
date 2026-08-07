import asyncio
import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.llm import StreamInterruptedError, chat_completion_stream_with_meta
from ..db.models import Session as SessionModel
from ..db.session import get_db
from ..schemas.ask import AskStreamRequest
from ..schemas.session import SessionDetail
from ..services.ask_service import (
    ASK_SYSTEM_PROMPT,
    AskContext,
    prepare_ask_context,
)
from .deps import current_user_id
from .search import _search_sessions_by_vector
from .sessions import _owned_session, _to_detail

router = APIRouter(prefix="/ask", tags=["ask"])
logger = logging.getLogger(__name__)


def encode_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


async def _resolve_sources(
    body: AskStreamRequest,
    db: AsyncSession,
    user_id: str,
) -> list[SessionDetail]:
    """답변 근거로 쓸 세션을 고른다. **반드시 요청자 소유 세션만** 대상으로 한다."""
    if body.session_id:
        # 소유권 확인을 거친다 — 남의 세션 id 로 그 내용을 요약해 받아갈 수 있으면 안 된다.
        session = await _owned_session(db, body.session_id, user_id)
        if session.status == "merged":
            raise HTTPException(status_code=404, detail="Session not found")
        return [_to_detail(session)]

    limit = (
        5 if body.intent == "find_sessions" else 1 if body.intent == "search_session" else 3
    )
    return await _search_sessions_by_vector(body.query, limit, body.rerank, db, user_id)


async def _answer_events(
    request: Request,
    context: AskContext,
) -> AsyncIterator[str]:
    yield encode_sse(
        "sources",
        {"sessions": [source.model_dump(mode="json") for source in context.sources]},
    )

    if not context.sources:
        message = "관련 탐색 기록을 찾지 못했어요. 다른 표현으로 질문해 주세요."
        yield encode_sse("delta", {"text": message})
        yield encode_sse("done", {"model": None})
        return

    if context.intent == "find_sessions":
        count = len(context.sources)
        yield encode_sse(
            "delta",
            {"text": f"관련 세션 {count}개를 찾았어요. 아래 목록에서 확인해 주세요."},
        )
        yield encode_sse("done", {"model": None})
        return

    model: str | None = None
    emitted = False
    try:
        async for text, provider_model in chat_completion_stream_with_meta(
            ASK_SYSTEM_PROMPT,
            context.prompt,
        ):
            if await request.is_disconnected():
                logger.info("Ask stream client disconnected")
                return
            emitted = True
            model = provider_model
            yield encode_sse("delta", {"text": text})
        yield encode_sse("done", {"model": model})
    except asyncio.CancelledError:
        logger.info("Ask stream cancelled")
        raise
    except StreamInterruptedError as exc:
        logger.warning("Ask stream interrupted after partial output (model=%s)", exc.model)
        yield encode_sse(
            "error",
            {"code": "stream_interrupted", "partial": True, "retryable": True},
        )
    except Exception:
        logger.exception("Ask answer generation failed")
        yield encode_sse(
            "error",
            {"code": "generation_failed", "partial": emitted, "retryable": True},
        )


@router.post("/stream")
async def stream_answer(
    body: AskStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(current_user_id),
) -> StreamingResponse:
    sources = await _resolve_sources(body, db, user_id)
    context = await prepare_ask_context(db, body.query, sources, user_id, body.intent)
    return StreamingResponse(
        _answer_events(request, context),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
