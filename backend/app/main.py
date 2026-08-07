import asyncio
import contextlib
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.analytics import router as analytics_router
from .api.ask import router as ask_router
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

app.include_router(sessions_router)
app.include_router(settings_router)
app.include_router(search_router)
app.include_router(events_router)
app.include_router(sync_router)
app.include_router(analytics_router)
app.include_router(ask_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
