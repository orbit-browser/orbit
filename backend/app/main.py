import asyncio
import contextlib
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from fastapi import Depends

from .api.analytics import router as analytics_router
from .api.auth import router as auth_router
from .api.deps import get_current_user
from .api.events import router as events_router
from .api.search import router as search_router
from .api.sessions import recover_pending_sessions
from .api.sessions import router as sessions_router
from .api.settings import router as settings_router
from .api.sync import router as sync_router
from .config import settings
from .db.session import init_db
from .db.vector import init_collection
from .services.sync_pipeline import periodic_sync_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_collection()
    await recover_pending_sessions()

    periodic_task: asyncio.Task | None = None
    if settings.sync_interval_minutes > 0:
        periodic_task = asyncio.create_task(periodic_sync_loop())

    yield

    if periodic_task:
        periodic_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await periodic_task


app = FastAPI(title="Orbit API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# /auth 만 무인증 — 로그인해야 토큰을 받을 수 있으므로.
app.include_router(auth_router)

# 나머지 데이터 라우터는 전부 인증 필수 (plan.md 결정 4).
# 라우터 단위로 의존성을 걸어 엔드포인트를 새로 추가해도 인증이 자동으로 적용된다 —
# 엔드포인트마다 붙이면 언젠가 하나를 빠뜨리고 그 경로로 데이터가 샌다.
_authenticated = [Depends(get_current_user)]

app.include_router(sessions_router, dependencies=_authenticated)
app.include_router(settings_router, dependencies=_authenticated)
app.include_router(search_router, dependencies=_authenticated)
app.include_router(events_router, dependencies=_authenticated)
app.include_router(sync_router, dependencies=_authenticated)
app.include_router(analytics_router, dependencies=_authenticated)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
